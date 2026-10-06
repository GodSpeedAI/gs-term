//! Minimal model2vec (potion) embedder for the concept store.
//!
//! Ported from zvec-grep's `zg-engine` model2vec backend
//! (`crates/zg-engine/src/models/backends/model2vec/`, Apache-2.0) with the
//! same math: mean of token embedding rows accumulated in f64, then L2
//! normalization, narrowed to f32 for parity with the reference worker.
//!
//! The model is `local/potion-code-16m-v2` (minishlab/potion-code-16M-v2,
//! revision `e9d2a44c…`, dimension 256). Artifacts are pinned by sha256 in the
//! upstream catalog (`models/catalog/entries.rs`, `POTION_CODE_ARTIFACTS`);
//! those constants are reproduced here so a cold download can be verified.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};

pub const MODEL_REFERENCE: &str = "local/potion-code-16m-v2";
pub const MODEL_REPO: &str = "minishlab/potion-code-16M-v2";
pub const MODEL_REVISION: &str = "e9d2a44ca6a05ac6685f3b23709ea57eb7352d5b";
pub const MODEL_DIMENSION: usize = 256;
pub const MAX_INPUT_TOKENS: usize = 1_024;

const MODEL_FILE: &str = "model.safetensors";
const TOKENIZER_FILE: &str = "tokenizer.json";
/// Pinned from zvec-grep `models/catalog/entries.rs` (Apache-2.0).
const MODEL_SHA256: &str = "75cf7a6c2171b230ad19b1e7d8e0b1aee86da5a02af8e7cacedd9921d227623c";
const MODEL_SIZE: u64 = 32_490_072;
const TOKENIZER_SHA256: &str = "107bbdcbad4bff1d299b7a4c3a2fb17c52890688b7dd0e4c9deab79d3c4f3d45";
const TOKENIZER_SIZE: u64 = 1_024_340;

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("model artifact invalid: {0}")]
    Invalid(String),
    #[error("model download failed: {0}")]
    Download(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Serialize)]
pub struct ModelStatus {
    pub reference: String,
    pub ready: bool,
    pub path: String,
    pub dimension: usize,
    pub revision: String,
}

struct StaticEmbeddingTable {
    values: Vec<f32>,
    rows: usize,
}

struct Loaded {
    table: StaticEmbeddingTable,
    tokenizer: tokenizers::Tokenizer,
}

/// Lazy, process-wide model. Embedding calls are serialized through the mutex
/// (concept indexing is small-volume; parallel batching is unnecessary).
pub struct Embedder {
    loaded: Mutex<Option<Loaded>>,
}

impl Embedder {
    pub const fn new() -> Self {
        Self {
            loaded: Mutex::new(None),
        }
    }

    /// Directory holding `model2vec/<repo-dir>/<revision>/…` for this cache
    /// root. The on-disk repo directory flattens the org delimiter to `--`
    /// (zg-engine's cache identity, e.g. `minishlab--potion-code-16M-v2`).
    pub fn model_dir() -> PathBuf {
        let repo_dir = MODEL_REPO.replace('/', "--");
        Self::cache_root()
            .join("model2vec")
            .join(repo_dir)
            .join(MODEL_REVISION)
    }

    /// Cache resolution: gs-term's own cache env first (`GSTERM_MODEL_CACHE`,
    /// set by the substrate for product-owned asset lifecycle), then the
    /// zg-engine chain `ZVEC_GREP_MODEL_CACHE` → `$ZVEC_GREP_HOME/models` →
    /// `~/.zvec-grep/models` (shared warm cache).
    fn cache_root() -> PathBuf {
        if let Some(dir) = std::env::var_os("GSTERM_MODEL_CACHE") {
            return PathBuf::from(dir);
        }
        if let Some(dir) = std::env::var_os("ZVEC_GREP_MODEL_CACHE") {
            return PathBuf::from(dir);
        }
        if let Some(home) = std::env::var_os("ZVEC_GREP_HOME") {
            return PathBuf::from(home).join("models");
        }
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(".zvec-grep").join("models");
        }
        PathBuf::from(".zvec-grep").join("models")
    }

    pub fn status(&self) -> ModelStatus {
        let dir = Self::model_dir();
        let ready =
            dir.join(MODEL_FILE).is_file() && dir.join("tokenizer").join(TOKENIZER_FILE).is_file();
        ModelStatus {
            reference: MODEL_REFERENCE.to_string(),
            ready,
            path: dir.display().to_string(),
            dimension: MODEL_DIMENSION,
            revision: MODEL_REVISION.to_string(),
        }
    }

    fn ensure_loaded(&self) -> Result<(), ModelError> {
        let mut guard = self
            .loaded
            .lock()
            .map_err(|_| ModelError::Invalid("model mutex poisoned".to_string()))?;
        if guard.is_some() {
            return Ok(());
        }
        let dir = Self::model_dir();
        let weights = dir.join(MODEL_FILE);
        let tokenizer = dir.join("tokenizer").join(TOKENIZER_FILE);
        if !weights.is_file() || !tokenizer.is_file() {
            Self::download(&dir)?;
        }
        *guard = Some(Loaded {
            table: Self::load_table(&weights)?,
            tokenizer: Self::load_tokenizer(&tokenizer)?,
        });
        Ok(())
    }

    fn load_table(path: &Path) -> Result<StaticEmbeddingTable, ModelError> {
        let bytes = std::fs::read(path)?;
        let tensors = safetensors::SafeTensors::deserialize(&bytes)
            .map_err(|e| ModelError::Invalid(format!("safetensors header: {e}")))?;
        let tensor = tensors
            .tensor("embeddings")
            .map_err(|e| ModelError::Invalid(format!("missing tensor 'embeddings': {e}")))?;
        let shape = tensor.shape();
        if shape.len() != 2 || shape[1] != MODEL_DIMENSION {
            return Err(ModelError::Invalid(format!(
                "unexpected embeddings shape {shape:?} (expected [rows, {MODEL_DIMENSION}])"
            )));
        }
        let rows = shape[0];
        let values: Vec<f32> = match tensor.dtype() {
            safetensors::Dtype::F32 => tensor
                .data()
                .as_chunks::<4>()
                .0
                .iter()
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect(),
            safetensors::Dtype::F16 => tensor
                .data()
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| half::f16::from_le_bytes([c[0], c[1]]).to_f32())
                .collect(),
            other => {
                return Err(ModelError::Invalid(format!(
                    "unsupported embeddings dtype {other:?}"
                )));
            }
        };
        Ok(StaticEmbeddingTable { values, rows })
    }

    fn load_tokenizer(path: &Path) -> Result<tokenizers::Tokenizer, ModelError> {
        tokenizers::Tokenizer::from_file(path)
            .map_err(|e| ModelError::Invalid(format!("tokenizer load: {e}")))
    }

    /// One-time, verified download into the cache layout (same layout zg-engine
    /// reads, so the shared cache stays interoperable).
    fn download(dir: &Path) -> Result<(), ModelError> {
        let base = format!("https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}");
        std::fs::create_dir_all(dir.join("tokenizer"))?;
        Self::download_verified(
            &format!("{base}/{MODEL_FILE}"),
            &dir.join(MODEL_FILE),
            MODEL_SHA256,
            MODEL_SIZE,
        )?;
        Self::download_verified(
            &format!("{base}/{TOKENIZER_FILE}"),
            &dir.join("tokenizer").join(TOKENIZER_FILE),
            TOKENIZER_SHA256,
            TOKENIZER_SIZE,
        )?;
        Ok(())
    }

    fn download_verified(
        url: &str,
        dest: &Path,
        sha256: &str,
        size: u64,
    ) -> Result<(), ModelError> {
        if let Ok(existing) = std::fs::metadata(dest)
            && existing.len() == size
            && Self::file_sha256(dest).is_ok_and(|h| h == sha256)
        {
            return Ok(());
        }
        let partial = dest.with_extension("part");
        let response = ureq::get(url)
            .call()
            .map_err(|e| ModelError::Download(format!("{url}: {e}")))?;
        let mut reader = response.into_body().into_reader();
        let mut file = std::fs::File::create(&partial)?;
        std::io::copy(&mut reader, &mut file)?;
        drop(file);
        let hash = Self::file_sha256(&partial)?;
        if hash != sha256 {
            let _ = std::fs::remove_file(&partial);
            return Err(ModelError::Download(format!(
                "{url}: sha256 mismatch (got {hash}, want {sha256})"
            )));
        }
        std::fs::rename(&partial, dest)?;
        Ok(())
    }

    fn file_sha256(path: &Path) -> Result<String, ModelError> {
        let mut file = std::fs::File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let read = file.read(&mut buf)?;
            if read == 0 {
                break;
            }
            hasher.update(&buf[..read]);
        }
        Ok(hex::encode(hasher.finalize()))
    }

    /// Embed one text. Empty/whitespace input yields the zero vector (the
    /// upstream backend behaves the same for empty token lists).
    pub fn embed(&self, text: &str) -> Result<Vec<f32>, ModelError> {
        self.embed_all(std::iter::once(text.to_string()))
            .map(|mut vectors| vectors.pop().unwrap_or_else(|| vec![0.0; MODEL_DIMENSION]))
    }

    pub fn embed_all(
        &self,
        texts: impl IntoIterator<Item = String>,
    ) -> Result<Vec<Vec<f32>>, ModelError> {
        self.ensure_loaded()?;
        let guard = self
            .loaded
            .lock()
            .map_err(|_| ModelError::Invalid("model mutex poisoned".to_string()))?;
        let loaded = guard.as_ref().expect("loaded after ensure");
        let table = &loaded.table;
        let mut vectors = Vec::new();
        for text in texts {
            let encoding = loaded
                .tokenizer
                .encode(text.as_str(), false)
                .map_err(|e| ModelError::Invalid(format!("tokenization failed: {e}")))?;
            // Truncate before pooling; skip the unknown token like upstream.
            let unknown = loaded.tokenizer.token_to_id("<unk>");
            let ids: Vec<u32> = encoding
                .get_ids()
                .iter()
                .take(MAX_INPUT_TOKENS)
                .copied()
                .filter(|id| Some(*id) != unknown)
                .collect();
            vectors.push(Self::pool(&ids, table)?);
        }
        Ok(vectors)
    }

    /// Mean of token rows accumulated in f64, L2-normalized, narrowed to f32 —
    /// the exact arithmetic of the upstream `embed_static_token_list`.
    fn pool(token_ids: &[u32], table: &StaticEmbeddingTable) -> Result<Vec<f32>, ModelError> {
        if token_ids.is_empty() {
            return Ok(vec![0.0; MODEL_DIMENSION]);
        }
        let mut vector = vec![0.0f64; MODEL_DIMENSION];
        for &id in token_ids {
            let row = id as usize;
            if row >= table.rows {
                return Err(ModelError::Invalid(format!(
                    "tokenizer returned out-of-range token id {id} (rows={})",
                    table.rows
                )));
            }
            let start = row * MODEL_DIMENSION;
            for (column, value) in vector.iter_mut().enumerate() {
                *value += f64::from(table.values[start + column]);
            }
        }
        let divisor = f64::from(token_ids.len() as u32);
        let mut squared_norm = 0.0f64;
        for value in &mut vector {
            *value /= divisor;
            squared_norm += *value * *value;
        }
        if squared_norm > 0.0 {
            let inverse = squared_norm.sqrt().recip();
            for value in &mut vector {
                *value *= inverse;
            }
        }
        Ok(vector.into_iter().map(|v| v as f32).collect())
    }
}
