//! Stdio JSON-lines protocol envelope for `gsterm-semantic`.
//!
//! One JSON object per line on stdin/stdout. Requests carry a numeric `id`;
//! responses echo it. Progress notifications have no `id` and are emitted
//! while a long request (indexing) is in flight.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "0.1.0";
pub const HELPER_NAME: &str = "gsterm-semantic";
/// Upstream zvec-grep revision vendored through the git dependency (provenance).
pub const ZG_ENGINE_REVISION: &str = "28ef2009838e509bdbeb43d06e04d0cf98e0b071";

#[derive(Deserialize)]
pub struct Request {
    pub id: Option<u64>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Serialize)]
pub struct Success<'a> {
    pub id: Option<u64>,
    pub ok: bool,
    pub result: &'a Value,
}

#[derive(Serialize)]
pub struct Failure<'a> {
    pub id: Option<u64>,
    pub ok: bool,
    pub error: ErrorBody<'a>,
}

#[derive(Serialize)]
pub struct ErrorBody<'a> {
    pub message: &'a str,
}

#[derive(Serialize)]
pub struct Notification<'a> {
    pub method: &'a str,
    pub params: &'a Value,
}

/// Serializes one output line. `write` is stdout (locked by the caller).
pub fn write_line<W: std::io::Write>(out: &mut W, value: &impl Serialize) -> std::io::Result<()> {
    let line = serde_json::to_string(value).map_err(std::io::Error::other)?;
    out.write_all(line.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()
}
