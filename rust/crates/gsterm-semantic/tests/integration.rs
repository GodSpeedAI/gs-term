//! Protocol + mechanism integration tests. Each test spawns the built helper
//! binary over real stdio (the same surface the Bun client drives).

use std::io::BufReader;
use std::io::{BufRead, Write as _};
use std::path::Path;
use std::process::ChildStdout;
use std::process::{Child, ChildStdin, Command, Stdio};

struct Helper {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    home: tempfile::TempDir,
}

impl Helper {
    /// Spawn with an isolated ZVEC_GREP_HOME; `with_shared_model_cache` points
    /// ZVEC_GREP_MODEL_CACHE at the machine's warm potion cache when present.
    fn spawn(with_shared_model_cache: bool) -> Option<Self> {
        let exe = env!("CARGO_BIN_EXE_gsterm-semantic");
        let home = tempfile::tempdir().expect("temp home");
        let mut command = Command::new(exe);
        command
            .env("ZVEC_GREP_HOME", home.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if with_shared_model_cache {
            let cache = shared_model_cache()?;
            command.env("ZVEC_GREP_MODEL_CACHE", cache);
        }
        let mut child = command.spawn().expect("spawn helper");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        Some(Self {
            child,
            stdin,
            stdout,
            next_id: 0,
            home,
        })
    }

    fn call(
        &mut self,
        method: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let line = serde_json::json!({ "id": id, "method": method, "params": params });
        writeln!(self.stdin, "{line}").map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())?;
        let stdout = &mut self.stdout;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(240);
        loop {
            if std::time::Instant::now() > deadline {
                return Err(format!("{method} timed out"));
            }
            let mut buffer = String::new();
            let read = stdout.read_line(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                return Err(format!("{method}: helper exited"));
            }
            let value: serde_json::Value = serde_json::from_str(buffer.trim())
                .map_err(|e| format!("malformed line: {e}: {buffer}"))?;
            if value.get("id").and_then(serde_json::Value::as_u64) != Some(id) {
                continue; // progress notification
            }
            if value.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
                return Err(value
                    .pointer("/error/message")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("error")
                    .to_string());
            }
            return Ok(value
                .get("result")
                .cloned()
                .unwrap_or(serde_json::Value::Null));
        }
    }

    fn shutdown(mut self) {
        let _ = writeln!(
            self.stdin,
            r#"{{"id":0,"method":"shutdown","params":{{}}}}"#
        );
        let _ = self.stdin.flush();
        let _ = self.child.wait();
    }
}

/// The warm zg model cache, when this machine has it (avoids redownloading).
fn shared_model_cache() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let cache = Path::new(&home).join(".zvec-grep/models");
    cache.is_dir().then(|| cache.display().to_string())
}

fn fixture_workspace(name: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("fixture");
    std::fs::write(
        dir.path().join("auth.ts"),
        "export function validateToken(token: string): boolean {\n  return token.length > 8;\n}\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("api.ts"),
        "import { validateToken } from \"./auth\";\nexport function handle(req: { token: string }): boolean {\n  return validateToken(req.token);\n}\n",
    )
    .unwrap();
    name;
    dir
}

#[test]
fn hello_reports_provenance() {
    let mut helper = Helper::spawn(false).expect("helper");
    let hello = helper.call("hello", &serde_json::json!({})).expect("hello");
    assert_eq!(hello["name"], "gsterm-semantic");
    assert_eq!(
        hello["zg_engine_revision"],
        "28ef2009838e509bdbeb43d06e04d0cf98e0b071"
    );
    assert_eq!(hello["model"]["dimension"], 256);
    helper.shutdown();
}

#[test]
fn malformed_line_reports_error_without_dying() {
    let mut helper = Helper::spawn(false).expect("helper");
    writeln!(helper.stdin, "not json at all").unwrap();
    helper.stdin.flush().unwrap();
    let mut buffer = String::new();
    helper.stdout.read_line(&mut buffer).unwrap();
    let value: serde_json::Value = serde_json::from_str(buffer.trim()).unwrap();
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["message"], "malformed request");
    // The process must still serve the next request.
    let hello = helper.call("hello", &serde_json::json!({})).expect("alive");
    assert_eq!(hello["name"], "gsterm-semantic");
    helper.shutdown();
}

#[test]
fn concept_lifecycle_replace_query_prune_reopen() {
    // The store lives in its own tempdir so it survives the first helper
    // process (whose ZVEC_GREP_HOME tempdir is cleaned up on drop).
    let store_root = tempfile::tempdir().expect("store dir");
    let store = store_root.path().join("concepts");
    let store_path = store.display().to_string();
    let mut helper = Helper::spawn(false).expect("helper");
    let docs = serde_json::json!([
        { "id": "c:focus", "kind": "concept", "label": "Human-governed focus", "text": "humans govern what the agent attends to; agents propose, humans accept or reject", "metadata": {"area": "focus"}, "links": ["src/semantic/focus.ts"] },
        { "id": "c:exec", "kind": "concept", "label": "Structured execution", "text": "structured argv execution through capability providers", "metadata": {"area": "execution"}, "links": [] }
    ]);
    let replaced = helper
        .call(
            "concept.replace",
            &serde_json::json!({ "path": store_path, "docs": docs, "prune": true }),
        )
        .expect("replace");
    assert_eq!(replaced["written"], 2);

    let queried = helper
        .call("concept.query", &serde_json::json!({ "path": store_path, "text": "who controls what the agent looks at", "topk": 2 }))
        .expect("query");
    let items = queried["items"].as_array().expect("items");
    assert_eq!(items.len(), 2);
    assert_eq!(
        items[0]["id"], "c:focus",
        "semantic match must rank the focus concept first"
    );
    assert!(
        items[0]["score"].as_f64().unwrap() < items[1]["score"].as_f64().unwrap(),
        "scores are ascending distances"
    );
    assert_eq!(items[0]["links"][0], "src/semantic/focus.ts");

    let pruned = helper
        .call("concept.replace", &serde_json::json!({
            "path": store_path,
            "docs": [{ "id": "c:focus", "kind": "concept", "label": "Human-governed focus", "text": "humans govern what the agent attends to; agents propose, humans accept or reject" }],
            "prune": true
        }))
        .expect("prune replace");
    assert_eq!(pruned["written"], 1);
    assert_eq!(pruned["pruned"], 1);

    // Reopen (fresh process) still serves the surviving doc. The first
    // helper must fully exit before the second spawns: zvec holds an
    // exclusive directory lock per collection.
    helper.shutdown();
    let mut helper2 = Helper::spawn(false).expect("helper2");
    let stats = helper2
        .call("concept.stats", &serde_json::json!({ "path": store_path }))
        .expect("stats");
    assert_eq!(stats["doc_count"], 1);
    helper2.shutdown();
}

#[test]
fn model2vec_embeddings_are_stable_and_normalized() -> Result<(), String> {
    let Some(mut helper) = Helper::spawn(true) else {
        eprintln!("skipping: no warm potion model cache on this machine");
        return Ok(());
    };
    let result = helper.call("model.status", &serde_json::json!({}))?;
    assert_eq!(
        result["ready"], true,
        "warm cache must be detected: {result}"
    );
    assert_eq!(result["dimension"], 256);
    helper.shutdown();
    Ok(())
}

#[test]
fn zg_index_search_and_incremental_refresh() -> Result<(), String> {
    let Some(mut helper) = Helper::spawn(true) else {
        eprintln!("skipping: no warm potion model cache on this machine");
        return Ok(());
    };
    let workspace = fixture_workspace("zg");
    let root = workspace.path().display().to_string();

    let indexed = helper.call("zg.index", &serde_json::json!({ "root": root }))?;
    assert_eq!(indexed["files_scanned"], 2, "index result: {indexed}");

    let search = helper.call(
        "zg.search",
        &serde_json::json!({
            "root": root,
            "query": "where is authentication validated",
            "mode": "hybrid",
            "limit": 5
        }),
    )?;
    assert_eq!(search["source"], "index");
    let items = search["items"].as_array().expect("items");
    assert!(
        !items.is_empty(),
        "hybrid search must return items: {search}"
    );
    assert!(items.iter().any(|item| {
        item["relative_path"] == "auth.ts"
            && item["symbol_name"] == "validateToken"
            && item["start_line"].as_u64() == Some(1)
    }));
    assert!(items[0]["snippet"].as_str().is_some());

    // Incremental: modify a file, then search with default auto_update; the
    // refreshed index must reflect the change (fresh status).
    std::fs::write(
        workspace.path().join("guard.ts"),
        "export function guardPassword(input: string): boolean {\n  return input.len() > 0;\n}\n",
    )
    .map_err(|e| e.to_string())?;
    let refreshed = helper.call(
        "zg.search",
        &serde_json::json!({
            "root": root,
            "query": "guardPassword password check",
            "mode": "hybrid",
            "limit": 5
        }),
    )?;
    let refreshed_items = refreshed["items"].as_array().expect("items");
    assert!(
        refreshed_items
            .iter()
            .any(|item| item["relative_path"] == "guard.ts"),
        "auto_update must pick up the new file: {refreshed}"
    );

    let info = helper.call(
        "zg.info",
        &serde_json::json!({ "root": root, "include_status": true }),
    )?;
    assert_eq!(info["indexed"], true, "info: {info}");

    let dropped = helper.call("zg.drop", &serde_json::json!({ "root": root }))?;
    assert_eq!(dropped["dropped"], true);
    helper.shutdown();
    Ok(())
}
