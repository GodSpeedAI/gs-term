//! `gsterm-semantic`: gs-term's native semantic helper.
//!
//! One managed process hosting the zvec-grep engine (workspace source
//! retrieval) and a zvec concept collection (gs-term concept objects) with
//! potion-code-16m-v2 embeddings. Speaks JSON-lines over stdio; a thin layer
//! over the engine APIs so the same request shapes can later become Tauri
//! commands. Engine errors never crash the process — every request reports a
//! structured error.

mod concepts;
mod model2vec;
mod proto;
mod zgrep;

use std::io::BufRead;
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::concepts::{ConceptDocInput, ConceptStore};
use crate::model2vec::Embedder;
use crate::proto::{PROTOCOL_VERSION, Request};
use crate::zgrep::Zg;

/// Serialized stdout: progress notifications arrive from engine worker threads
/// while responses come from the dispatch loop.
fn out() -> &'static Mutex<std::io::Stdout> {
    static OUT: OnceLock<Mutex<std::io::Stdout>> = OnceLock::new();
    OUT.get_or_init(|| Mutex::new(std::io::stdout()))
}

/// Emitted by the zvec-grep progress reporter while indexing.
pub fn emit_progress(value: &Value) {
    if let Ok(mut out) = out().lock() {
        let _ = proto::write_line(
            &mut *out,
            &proto::Notification {
                method: "progress",
                params: value,
            },
        );
    }
}

fn respond(value: &impl serde::Serialize) {
    if let Ok(mut out) = out().lock() {
        let _ = proto::write_line(&mut *out, value);
    }
}

struct Dispatcher {
    zg: Zg,
    embedder: Embedder,
    concepts: ConceptStore,
    /// model_cache override honored for every zg call (kept process-wide).
    model_cache: Option<String>,
}

#[derive(Deserialize)]
struct SearchParams {
    root: String,
    query: String,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default = "default_limit")]
    limit: usize,
    #[serde(default)]
    refresh: Option<String>,
    #[serde(default)]
    file_types: Vec<String>,
}

fn default_mode() -> String {
    "hybrid".to_string()
}

fn default_limit() -> usize {
    8
}

#[derive(Deserialize)]
struct ReplaceParams {
    path: String,
    docs: Vec<ConceptDocInput>,
    #[serde(default)]
    prune: Option<bool>,
}

fn error_value(message: &str) -> Value {
    json!({ "message": message })
}

impl Dispatcher {
    fn dispatch(&mut self, request: &Request) -> Value {
        match request.method.as_str() {
            "hello" => json!({
                "name": proto::HELPER_NAME,
                "version": PROTOCOL_VERSION,
                "zg_engine_revision": proto::ZG_ENGINE_REVISION,
                "zvec_version": zvec_rust::version(),
                "caps": ["zg", "concepts"],
                "model": {
                    "reference": model2vec::MODEL_REFERENCE,
                    "dimension": model2vec::MODEL_DIMENSION,
                },
            }),
            "zg.index" => {
                let params = &request.params;
                match (
                    params.get("root").and_then(Value::as_str),
                    params.get("embedding").and_then(Value::as_str),
                    params
                        .get("rebuild")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                ) {
                    (Some(root), embedding, rebuild) => {
                        match self
                            .zg
                            .index(root, embedding, rebuild, self.model_cache.as_deref())
                        {
                            Ok(result) => result,
                            Err(error) => error_value(&error.to_string()),
                        }
                    }
                    _ => error_value("zg.index requires {root}"),
                }
            }
            "zg.info" => {
                let params = &request.params;
                match params.get("root").and_then(Value::as_str) {
                    Some(root) => {
                        let include_status = params
                            .get("include_status")
                            .and_then(Value::as_bool)
                            .unwrap_or(true);
                        match self.zg.info(root, include_status) {
                            Ok(result) => result,
                            Err(error) => error_value(&error.to_string()),
                        }
                    }
                    _ => error_value("zg.info requires {root}"),
                }
            }
            "zg.search" => match serde_json::from_value::<SearchParams>(request.params.clone()) {
                Ok(params) => match self.zg.search(
                    &params.root,
                    &params.query,
                    &params.mode,
                    params.limit,
                    params.refresh.as_deref(),
                    &params.file_types,
                    self.model_cache.as_deref(),
                ) {
                    Ok(result) => serde_json::to_value(&result)
                        .unwrap_or_else(|_| error_value("serialize failed")),
                    Err(error) => error_value(&error.to_string()),
                },
                Err(error) => error_value(&format!("invalid zg.search params: {error}")),
            },
            "zg.drop" => {
                let params = &request.params;
                match params.get("root").and_then(Value::as_str) {
                    Some(root) => match self.zg.drop_index(root) {
                        Ok(dropped) => json!({ "dropped": dropped }),
                        Err(error) => error_value(&error.to_string()),
                    },
                    _ => error_value("zg.drop requires {root}"),
                }
            }
            "model.status" => serde_json::to_value(self.embedder.status())
                .unwrap_or_else(|_| error_value("serialize failed")),
            "concept.ensure" | "concept.stats" => {
                let params = &request.params;
                match params.get("path").and_then(Value::as_str) {
                    Some(path) => match concepts::stats(&mut self.concepts, path) {
                        Ok(doc_count) => json!({ "doc_count": doc_count }),
                        Err(error) => error_value(&error.to_string()),
                    },
                    _ => error_value("concept operation requires {path}"),
                }
            }
            "concept.replace" => {
                match serde_json::from_value::<ReplaceParams>(request.params.clone()) {
                    Ok(params) => match concepts::replace(
                        &mut self.concepts,
                        &params.path,
                        &params.docs,
                        params.prune.unwrap_or(false),
                        &self.embedder,
                    ) {
                        Ok(outcome) => serde_json::to_value(&outcome)
                            .unwrap_or_else(|_| error_value("serialize failed")),
                        Err(error) => error_value(&error.to_string()),
                    },
                    Err(error) => error_value(&format!("invalid concept.replace params: {error}")),
                }
            }
            "concept.query" => {
                let params = &request.params;
                match (
                    params.get("path").and_then(Value::as_str),
                    params.get("text").and_then(Value::as_str),
                ) {
                    (Some(path), Some(text)) => {
                        let topk = params.get("topk").and_then(Value::as_u64).unwrap_or(8) as usize;
                        let kind = params.get("kind").and_then(Value::as_str);
                        match concepts::query(
                            &mut self.concepts,
                            path,
                            text,
                            topk,
                            kind,
                            &self.embedder,
                        ) {
                            Ok(items) => json!({ "items": items }),
                            Err(error) => error_value(&error.to_string()),
                        }
                    }
                    _ => error_value("concept.query requires {path, text}"),
                }
            }
            "shutdown" => json!({ "bye": true }),
            other => error_value(&format!("unknown method {other}")),
        }
    }
}

fn main() {
    let mut dispatcher = Dispatcher {
        zg: Zg::new(),
        embedder: Embedder::new(),
        concepts: ConceptStore::new(),
        model_cache: std::env::var("GSTERM_MODEL_CACHE").ok(),
    };

    let stdin = std::io::stdin();
    let mut shutdown_requested = false;
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break, // stdin closed: parent is gone or disposed
        };
        if line.trim().is_empty() {
            continue;
        }
        let request: Option<Request> = serde_json::from_str(&line).ok();
        let (id, reply) = match request {
            Some(request) => {
                if request.method == "shutdown" {
                    shutdown_requested = true;
                }
                (request.id, dispatcher.dispatch(&request))
            }
            None => (None, error_value("malformed request")),
        };
        match reply.get("message").and_then(Value::as_str) {
            Some(message) => respond(&proto::Failure {
                id,
                ok: false,
                error: proto::ErrorBody { message },
            }),
            None => respond(&proto::Success {
                id,
                ok: true,
                result: &reply,
            }),
        }
        if shutdown_requested {
            break;
        }
    }
    dispatcher.zg.close();
}
