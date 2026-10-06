//! zvec-grep engine adapter: workspace source retrieval through `zg-engine`.
//!
//! The engine is the authoritative hybrid (FTS+vector) source-retrieval
//! mechanism. `auto_update` stays enabled so searches self-heal stale indexes
//! synchronously; `RefreshPolicy::Off` is honored when the caller asks for a
//! no-refresh read. Engine results are normalized through serde JSON because
//! `zg_engine::domain` is private — the serialized shapes are the engine's
//! public contract.

use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Serialize;
use serde_json::Value;
use tokio::runtime::Runtime;
use zg_engine::ZvecGrep;
use zg_engine::api::context::options::{
    ContextOptions, ContextRoute, ContextRouteMode, QueryFilter, RefreshPolicy,
};
use zg_engine::api::index::options::{Device, EmbeddingModelSpec, IndexOptions};
use zg_engine::api::index::progress::{IndexProgress, IndexProgressReporter};
use zg_engine::api::info::options::InfoOptions;

#[derive(Debug, thiserror::Error)]
pub enum ZgError {
    #[error("engine error: {0}")]
    Engine(String),
    #[error("serialize error: {0}")]
    Serialize(String),
}

impl From<zg_engine::EngineError> for ZgError {
    fn from(error: zg_engine::EngineError) -> Self {
        Self::Engine(error.to_string())
    }
}

/// One normalized search hit (bounded; 1-based lines; snippet hard-capped).
#[derive(Serialize)]
pub struct SearchItem {
    pub relative_path: String,
    pub start_line: Option<usize>,
    pub end_line: Option<usize>,
    pub snippet: String,
    pub score: Option<f64>,
    pub matched_by: String,
    pub symbol_name: Option<String>,
    pub symbol_type: Option<String>,
    pub status: String,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub source: String,
    pub coverage: String,
    pub items: Vec<SearchItem>,
}

const SNIPPET_LIMIT: usize = 400;

/// One shared multi-thread runtime for all engine calls. Requests are
/// dispatched sequentially; the runtime exists because the engine API is async.
fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| Runtime::new().expect("tokio runtime"))
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    runtime().block_on(future)
}

pub struct Zg {
    engine: ZvecGrep,
}

impl Zg {
    pub fn new() -> Self {
        let engine = ZvecGrep::new();
        // Resident-process optimization: reuse index read handles across
        // searches (internal 60s idle close).
        let _ = engine.enable_read_session_cache();
        Self { engine }
    }

    fn progress_reporter() -> IndexProgressReporter {
        IndexProgressReporter::new(|progress: IndexProgress| {
            let value = serde_json::json!({
                "phase": format!("{:?}", progress.phase).to_lowercase(),
                "files_total": progress.files_total,
                "files_indexed": progress.files_indexed,
                "files_failed": progress.files_failed,
                "detail": progress.detail,
                "embedding": progress.embedding.map(|embedding| serde_json::json!({
                    "stage": embedding.stage.map(|stage| format!("{stage:?}").to_lowercase()),
                    "model": embedding.model,
                    "downloaded_bytes": embedding.downloaded_bytes,
                    "total_bytes": embedding.total_bytes,
                    "message": embedding.message,
                })),
            });
            crate::emit_progress(&value);
        })
    }

    pub fn index(
        &self,
        root: &str,
        embedding: Option<&str>,
        rebuild: bool,
        model_cache: Option<&str>,
    ) -> Result<Value, ZgError> {
        let options = IndexOptions {
            root: Some(PathBuf::from(root)),
            rebuild,
            embedding: embedding.map(|reference| EmbeddingModelSpec {
                reference: reference.to_string(),
                revision: None,
                cache_dir: model_cache.map(PathBuf::from),
                endpoint: None,
                device: Device::Cpu,
            }),
            model_cache: model_cache.map(PathBuf::from),
            on_progress: Some(Self::progress_reporter()),
            ..IndexOptions::default()
        };
        let result = block_on(self.engine.index(options))?;
        serde_json::to_value(result).map_err(|e| ZgError::Serialize(e.to_string()))
    }

    pub fn info(&self, root: &str, include_status: bool) -> Result<Value, ZgError> {
        let options = InfoOptions {
            root: Some(PathBuf::from(root)),
            include_status,
        };
        let result = block_on(self.engine.info(options))?;
        serde_json::to_value(result).map_err(|e| ZgError::Serialize(e.to_string()))
    }

    pub fn drop_index(&self, root: &str) -> Result<bool, ZgError> {
        let options = InfoOptions {
            root: Some(PathBuf::from(root)),
            include_status: false,
        };
        Ok(block_on(self.engine.drop_index(options))?)
    }

    /// Hybrid / FTS / vector search over the workspace index.
    #[allow(clippy::too_many_arguments)]
    pub fn search(
        &self,
        root: &str,
        query: &str,
        mode: &str,
        limit: usize,
        refresh: Option<&str>,
        file_types: &[String],
        model_cache: Option<&str>,
    ) -> Result<SearchResult, ZgError> {
        let policy = match refresh {
            Some("off") => Some(RefreshPolicy::Off),
            Some("wait") => Some(RefreshPolicy::Wait),
            _ => None,
        };
        let filter = QueryFilter {
            file_types: file_types.to_vec(),
            ..QueryFilter::default()
        };
        let mut options = ContextOptions {
            root: Some(PathBuf::from(root)),
            limit: Some(limit),
            refresh: policy,
            filter,
            model_cache: model_cache.map(PathBuf::from),
            ..ContextOptions::default()
        };
        match mode {
            "fts" => {
                options.routes = vec![ContextRoute {
                    mode: ContextRouteMode::Fts,
                    query: query.to_string(),
                }];
            }
            "vector" => {
                options.routes = vec![ContextRoute {
                    mode: ContextRouteMode::Vector,
                    query: query.to_string(),
                }];
            }
            // Default and "hybrid": one primary query runs both routes.
            _ => options.query = Some(query.to_string()),
        }
        let result = block_on(self.engine.context(options))?;
        let value = serde_json::to_value(&result).map_err(|e| ZgError::Serialize(e.to_string()))?;
        Ok(Self::normalize(&value))
    }

    /// Map the serialized ContextResult onto the bounded item shape.
    fn normalize(value: &Value) -> SearchResult {
        let source = value
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("index")
            .to_string();
        let coverage = value
            .get("coverage")
            .and_then(Value::as_str)
            .unwrap_or("ranked_sample")
            .to_string();
        let empty = Vec::new();
        let raw_items = value
            .get("items")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let items = raw_items
            .iter()
            .filter_map(|item| {
                let relative_path = item
                    .get("relative_path")
                    .and_then(Value::as_str)?
                    .to_string();
                let range = item.get("range");
                let start_line = range
                    .and_then(|r| r.get("start_line"))
                    .and_then(Value::as_u64)
                    .map(|v| v as usize);
                let end_line = range
                    .and_then(|r| r.get("end_line"))
                    .and_then(Value::as_u64)
                    .map(|v| v as usize);
                let snippet = item
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .chars()
                    .take(SNIPPET_LIMIT)
                    .collect();
                let metadata = item
                    .get("metadata")
                    .filter(|m| m.get("kind").and_then(Value::as_str) == Some("code"));
                Some(SearchItem {
                    relative_path,
                    start_line,
                    end_line,
                    snippet,
                    score: item.get("score").and_then(Value::as_f64),
                    matched_by: item
                        .get("matched_by")
                        .and_then(Value::as_str)
                        .unwrap_or("lexical")
                        .to_string(),
                    symbol_name: metadata
                        .and_then(|m| m.get("symbol_name"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    symbol_type: metadata
                        .and_then(|m| m.get("symbol_type"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    status: item
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("fresh")
                        .to_string(),
                })
            })
            .collect();
        SearchResult {
            source,
            coverage,
            items,
        }
    }

    pub fn close(&self) {
        self.engine.close();
    }
}
