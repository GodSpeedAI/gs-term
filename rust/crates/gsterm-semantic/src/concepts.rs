//! gs-term concept collection over zvec-rust.
//!
//! Concept objects are gs-term's OWN application-domain concepts (never source
//! chunks — zvec-grep owns source retrieval). Links are the authoritative
//! structure; embeddings only retrieve. zvec cosine scores are DISTANCES
//! (0 = identical, ascending = better).

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use zvec_rust::{
    Collection, CollectionSchema, DataType, Doc, FieldSchema, IndexParams, MetricType, SearchQuery,
};

use crate::model2vec::{Embedder, ModelError};

pub const CONCEPT_DIMENSION: u32 = 256;
const COLLECTION_NAME: &str = "gsterm_concepts";
const VECTOR_FIELD: &str = "embedding";

#[derive(Debug, thiserror::Error)]
pub enum ConceptError {
    #[error("zvec error: {0}")]
    Zvec(String),
    #[error("model error: {0}")]
    Model(#[from] ModelError),
    #[error("serialize error: {0}")]
    Serialize(String),
}

impl From<zvec_rust::Error> for ConceptError {
    fn from(error: zvec_rust::Error) -> Self {
        Self::Zvec(error.to_string())
    }
}

#[derive(Deserialize)]
pub struct ConceptDocInput {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub text: String,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    #[serde(default)]
    pub links: Vec<String>,
}

#[derive(Serialize)]
pub struct ConceptMatch {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub score: f32,
    pub metadata: Value,
    pub links: Value,
}

#[derive(Serialize)]
pub struct ReplaceOutcome {
    pub written: u64,
    pub pruned: u64,
}

/// Open-or-create the concept collection at `path`.
///
/// zvec collections hold a directory-level LOCK that cannot be re-acquired by
/// a second open in the same process, so callers MUST cache the opened
/// collection for the process lifetime (`ConceptStore`).
fn open_collection(path: &str) -> Result<Collection, ConceptError> {
    if Path::new(path).is_dir()
        && let Ok(existing) = Collection::open(path, None)
    {
        return Ok(existing);
    }
    let schema = CollectionSchema::builder(COLLECTION_NAME)
        .add_field(FieldSchema::new("id", DataType::String, false, 0)?)
        .add_indexed_field("kind", DataType::String, IndexParams::invert(false, false)?)
        .add_field(FieldSchema::new("label", DataType::String, false, 0)?)
        .add_field(FieldSchema::new("text", DataType::String, false, 0)?)
        .add_field(FieldSchema::new("metadata", DataType::String, false, 0)?)
        .add_field(FieldSchema::new("links", DataType::String, false, 0)?)
        .add_vector_field(
            VECTOR_FIELD,
            DataType::VectorFp32,
            CONCEPT_DIMENSION,
            IndexParams::hnsw(MetricType::Cosine, 16, 200)?,
        )
        .build()?;
    Collection::create_and_open(path, &schema, None).or_else(|error| {
        // An existing-but-empty directory (created by tooling) is not a store:
        // zvec create refuses existing paths, so adopt it by removing the
        // empty shell. A NON-empty directory without a valid store is an error.
        let dir = Path::new(path);
        if dir.is_dir()
            && dir
                .read_dir()
                .is_ok_and(|mut entries| entries.next().is_none())
            && std::fs::remove_dir(dir).is_ok() {
                return Collection::create_and_open(path, &schema, None)
                    .map_err(ConceptError::from);
            }
        Err(ConceptError::Zvec(error.to_string()))
    })
}

/// Process-lifetime cache of open concept collections, keyed by store path.
/// The helper process is the SOLE owner of each collection directory (zvec
/// holds an exclusive lock), so all retrieval goes through this process.
#[derive(Default)]
pub struct ConceptStore {
    open: HashMap<String, Collection>,
}

impl ConceptStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn collection(&mut self, path: &str) -> Result<&Collection, ConceptError> {
        if !self.open.contains_key(path) {
            let collection = open_collection(path)?;
            self.open.insert(path.to_string(), collection);
        }
        Ok(&self.open[path])
    }
}

fn doc_from_input(input: &ConceptDocInput, vector: &[f32]) -> Result<Doc, ConceptError> {
    let mut doc = Doc::new().map_err(ConceptError::from)?;
    doc.set_pk(&input.id);
    doc.add_string("id", &input.id)?;
    doc.add_string("kind", &input.kind)?;
    doc.add_string("label", &input.label)?;
    doc.add_string("text", &input.text)?;
    doc.add_string(
        "metadata",
        &serde_json::to_string(&input.metadata)
            .map_err(|e| ConceptError::Serialize(e.to_string()))?,
    )?;
    doc.add_string(
        "links",
        &serde_json::to_string(&input.links).map_err(|e| ConceptError::Serialize(e.to_string()))?,
    )?;
    doc.add_vector_f32(VECTOR_FIELD, vector)?;
    Ok(doc)
}

/// Replace the whole concept set: embed + upsert all docs, optionally pruning
/// stored ids that are absent from the incoming set. Flushes before returning.
pub fn replace(
    store: &mut ConceptStore,
    path: &str,
    docs: &[ConceptDocInput],
    prune: bool,
    embedder: &Embedder,
) -> Result<ReplaceOutcome, ConceptError> {
    let collection = store.collection(path)?;
    let vectors = embedder.embed_all(docs.iter().map(|doc| doc.text.clone()))?;
    let owned: Vec<Doc> = docs
        .iter()
        .zip(&vectors)
        .map(|(input, vector)| doc_from_input(input, vector))
        .collect::<Result<_, _>>()?;
    let refs: Vec<&Doc> = owned.iter().collect();
    let written = collection.upsert(&refs)?.success_count;
    let mut pruned = 0u64;
    if prune {
        let known: HashSet<String> = docs.iter().map(|doc| doc.id.clone()).collect();
        // Iterator errors must not be silently dropped or pruning would
        // quietly become a no-op.
        let mut stale: Vec<String> = Vec::new();
        for item in collection.iter()? {
            let doc = item?;
            if let Some(pk) = doc.get_pk()
                && !known.contains(pk)
            {
                stale.push(pk.to_string());
            }
        }
        if !stale.is_empty() {
            let keys: Vec<&str> = stale.iter().map(String::as_str).collect();
            pruned = collection.delete(&keys)?.success_count;
        }
    }
    collection.flush()?;
    Ok(ReplaceOutcome { written, pruned })
}

/// Vector query over concepts. `kind`, when provided, narrows via the inverted
/// scalar index. Returns at most `topk` matches, ascending distance.
pub fn query(
    store: &mut ConceptStore,
    path: &str,
    text: &str,
    topk: usize,
    kind: Option<&str>,
    embedder: &Embedder,
) -> Result<Vec<ConceptMatch>, ConceptError> {
    let collection = store.collection(path)?;
    let vector = embedder.embed(text)?;
    let mut search = SearchQuery::new(VECTOR_FIELD, &vector, topk as i32)?;
    if let Some(kind) = kind {
        search.set_filter(&format!("kind = '{kind}'"))?;
    }
    search.set_output_fields(&["id", "kind", "label", "metadata", "links"])?;
    let matches = collection.query(&search)?;
    Ok(matches
        .iter()
        .map(|doc| ConceptMatch {
            id: string_field(doc, "id")
                .unwrap_or_else(|| doc.get_pk().unwrap_or_default().to_string()),
            kind: string_field(doc, "kind").unwrap_or_default(),
            label: string_field(doc, "label").unwrap_or_default(),
            score: doc.get_score(),
            metadata: json_field(doc, "metadata"),
            links: json_field(doc, "links"),
        })
        .collect())
}

pub fn stats(store: &mut ConceptStore, path: &str) -> Result<u64, ConceptError> {
    let collection = store.collection(path)?;
    Ok(collection.stats()?.doc_count)
}

fn string_field(doc: &Doc, name: &str) -> Option<String> {
    doc.get_string(name).ok().flatten()
}

fn json_field(doc: &Doc, name: &str) -> Value {
    string_field(doc, name)
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(Value::Null)
}
