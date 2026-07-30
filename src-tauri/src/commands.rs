use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension};
use tauri::{AppHandle, Manager, State};

use crate::blobs::{self, BlobInfo};
use crate::clipboard::{self, Pasteboard};
use crate::db::Db;
use crate::models::{ItemContent, NewContent, Node, SearchHit};

/// Undo/redo retention window from settings (PLAN.md §6/§7). `0` seconds ->
/// `Duration::ZERO`, which disables undo/redo.
fn undo_ttl(app: &AppHandle) -> Duration {
    Duration::from_secs(crate::settings::load(app).undo_seconds.max(0) as u64)
}

/// Commands return a stringified error so it crosses the IPC boundary as JSON.
type CmdResult<T> = Result<T, String>;

const NODE_COLS: &str =
    "id, parent_id, kind, name, position, created_at, updated_at, last_used_at";

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn row_to_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<Node> {
    Ok(Node {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        position: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        last_used_at: row.get(7)?,
    })
}

/// Next free position among a parent's children (append to the end).
fn next_position(conn: &Connection, parent_id: Option<i64>) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM nodes WHERE parent_id IS ?1",
        [parent_id],
        |row| row.get(0),
    )
}

// ---- pure DB operations (unit-testable without Tauri) ----------------------

pub fn get_node(conn: &Connection, id: i64) -> rusqlite::Result<Option<Node>> {
    conn.query_row(
        &format!("SELECT {NODE_COLS} FROM nodes WHERE id = ?1"),
        [id],
        row_to_node,
    )
    .optional()
}

pub fn list_children(conn: &Connection, parent_id: Option<i64>) -> rusqlite::Result<Vec<Node>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {NODE_COLS} FROM nodes WHERE parent_id IS ?1 ORDER BY position, id"
    ))?;
    let rows = stmt.query_map([parent_id], row_to_node)?;
    rows.collect()
}

pub fn create_group(conn: &Connection, parent_id: Option<i64>, name: &str) -> rusqlite::Result<Node> {
    let now = now_unix();
    let position = next_position(conn, parent_id)?;
    conn.execute(
        "INSERT INTO nodes (parent_id, kind, name, position, created_at, updated_at)
         VALUES (?1, 'group', ?2, ?3, ?4, ?4)",
        rusqlite::params![parent_id, name, position, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(get_node(conn, id)?.expect("just-inserted group exists"))
}

pub fn create_item(
    conn: &mut Connection,
    parent_id: Option<i64>,
    name: &str,
    content: &NewContent,
) -> rusqlite::Result<Node> {
    let now = now_unix();
    let position = next_position(conn, parent_id)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO nodes (parent_id, kind, name, position, created_at, updated_at)
         VALUES (?1, 'item', ?2, ?3, ?4, ?4)",
        rusqlite::params![parent_id, name, position, now],
    )?;
    let id = tx.last_insert_rowid();
    match content {
        NewContent::Text { text } => {
            tx.execute(
                "INSERT INTO items (node_id, content_type, text_content) VALUES (?1, 'text', ?2)",
                rusqlite::params![id, text],
            )?;
        }
    }
    let node = get_node(&tx, id)?.expect("just-inserted item exists");
    tx.commit()?;
    Ok(node)
}

/// Create an image or gif item backed by an already-stored blob. Used by the
/// seed here and by the paste path in M5.
pub fn create_blob_item(
    conn: &mut Connection,
    parent_id: Option<i64>,
    name: &str,
    content_type: &str,
    blob: &BlobInfo,
    dimensions: Option<(i64, i64)>,
) -> rusqlite::Result<Node> {
    let now = now_unix();
    let position = next_position(conn, parent_id)?;
    let (width, height) = match dimensions {
        Some((w, h)) => (Some(w), Some(h)),
        None => (None, None),
    };
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO nodes (parent_id, kind, name, position, created_at, updated_at)
         VALUES (?1, 'item', ?2, ?3, ?4, ?4)",
        rusqlite::params![parent_id, name, position, now],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO items (node_id, content_type, blob_path, blob_hash, byte_size, width, height)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, content_type, blob.rel_path, blob.hash, blob.byte_size, width, height],
    )?;
    let node = get_node(&tx, id)?.expect("just-inserted item exists");
    tx.commit()?;
    Ok(node)
}

/// Read an item's content for display. Blob paths are resolved to absolute
/// filesystem paths under `blobs_dir`.
pub fn get_item_content(
    conn: &Connection,
    blobs_dir: &Path,
    item_id: i64,
) -> rusqlite::Result<Option<ItemContent>> {
    conn.query_row(
        "SELECT content_type, text_content, blob_path, width, height FROM items WHERE node_id = ?1",
        [item_id],
        |row| {
            let content_type: String = row.get(0)?;
            let text: Option<String> = row.get(1)?;
            let blob_path: Option<String> = row.get(2)?;
            let width: Option<i64> = row.get(3)?;
            let height: Option<i64> = row.get(4)?;
            let abs = |p: Option<String>| {
                blobs_dir
                    .join(p.unwrap_or_default())
                    .to_string_lossy()
                    .into_owned()
            };
            Ok(match content_type.as_str() {
                "image" => ItemContent::Image { path: abs(blob_path), width, height },
                "gif" => ItemContent::Gif { path: abs(blob_path), width, height },
                _ => ItemContent::Text { text: text.unwrap_or_default() },
            })
        },
    )
    .optional()
}

// ---- search & recent (PLAN.md §4, §5.1, §5.2) ------------------------------

/// Turn arbitrary user input into a safe FTS5 MATCH expression: each
/// alphanumeric token becomes a quoted prefix term (`"tok"*`), so FTS5 operators
/// in the input are treated literally and typing is incremental / Spotlight-like.
fn fts_query(raw: &str) -> String {
    raw.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.to_lowercase()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Breadcrumb of ancestor group names, root-first, e.g. "Code Snippets / Rust".
fn ancestor_path(conn: &Connection, mut parent_id: Option<i64>) -> rusqlite::Result<String> {
    let mut names = Vec::new();
    let mut guard = 0;
    while let Some(pid) = parent_id {
        guard += 1;
        if guard > 64 {
            break; // defensive against cycles
        }
        let row: Option<(String, Option<i64>)> = conn
            .query_row(
                "SELECT name, parent_id FROM nodes WHERE id = ?1",
                [pid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match row {
            Some((name, next)) => {
                names.push(name);
                parent_id = next;
            }
            None => break,
        }
    }
    names.reverse();
    Ok(names.join(" / "))
}

pub fn search(conn: &Connection, raw: &str) -> rusqlite::Result<Vec<SearchHit>> {
    let query = fts_query(raw);
    if query.is_empty() {
        return Ok(Vec::new());
    }
    // Name matches outrank content matches via the 10:1 bm25 column weights.
    let mut stmt = conn.prepare(
        "SELECT n.id, n.name, n.parent_id
         FROM item_search s JOIN nodes n ON n.id = s.rowid
         WHERE item_search MATCH ?1
         ORDER BY bm25(item_search, 10.0, 1.0)
         LIMIT 200",
    )?;
    let rows: Vec<(i64, String, Option<i64>)> = stmt
        .query_map([&query], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;

    rows.into_iter()
        .map(|(id, name, parent_id)| {
            Ok(SearchHit {
                id,
                name,
                path: ancestor_path(conn, parent_id)?,
            })
        })
        .collect()
}

/// Recent items derived from `last_used_at` (PLAN.md §4). `max == 0` disables the
/// list; `persistence_secs == 0` means no time filter.
pub fn get_recent(
    conn: &Connection,
    max: i64,
    persistence_secs: i64,
) -> rusqlite::Result<Vec<Node>> {
    if max <= 0 {
        return Ok(Vec::new());
    }
    let cutoff = if persistence_secs <= 0 {
        0
    } else {
        now_unix() - persistence_secs
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {NODE_COLS} FROM nodes
         WHERE kind = 'item' AND last_used_at IS NOT NULL
           AND (?1 = 0 OR last_used_at >= ?2)
         ORDER BY last_used_at DESC
         LIMIT ?3"
    ))?;
    let rows = stmt.query_map(
        rusqlite::params![persistence_secs, cutoff, max],
        row_to_node,
    )?;
    rows.collect()
}

pub fn rename_node(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE nodes SET name = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, name, now_unix()],
    )?;
    Ok(())
}

pub fn delete_node(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    // Descendants and the items row go via ON DELETE CASCADE.
    conn.execute("DELETE FROM nodes WHERE id = ?1", [id])?;
    Ok(())
}

pub fn move_node(
    conn: &Connection,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE nodes SET parent_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, new_parent_id, new_position, now_unix()],
    )?;
    Ok(())
}

/// Encode a small gradient PNG so the seed has a real image to render.
fn sample_png() -> image::ImageResult<Vec<u8>> {
    let (w, h) = (96u32, 64u32);
    let mut img = image::RgbImage::new(w, h);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgb([(x * 255 / w) as u8, (y * 255 / h) as u8, 140]);
    }
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    Ok(png)
}

// ---- item content overwrite + single-level undo/redo (PLAN.md §6) ----------

/// A snapshot of an item's `items` row, used as the paste undo/redo payload.
#[derive(Clone, Debug, PartialEq)]
pub struct StoredContent {
    pub content_type: String,
    pub text_content: Option<String>,
    pub blob_path: Option<String>,
    pub blob_hash: Option<String>,
    pub byte_size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

impl StoredContent {
    pub fn text(text: String) -> Self {
        Self {
            content_type: "text".into(),
            text_content: Some(text),
            blob_path: None,
            blob_hash: None,
            byte_size: None,
            width: None,
            height: None,
        }
    }

    pub fn blob(kind: &str, blob: &BlobInfo, dims: Option<(i64, i64)>) -> Self {
        let (width, height) = dims.map_or((None, None), |(w, h)| (Some(w), Some(h)));
        Self {
            content_type: kind.into(),
            text_content: None,
            blob_path: Some(blob.rel_path.clone()),
            blob_hash: Some(blob.hash.clone()),
            byte_size: Some(blob.byte_size),
            width,
            height,
        }
    }
}

/// One item's undo slot: at most one previous content and one redo content.
pub struct UndoSlot {
    pub undo: Option<StoredContent>,
    pub redo: Option<StoredContent>,
    pub at: Instant,
}

/// Tauri-managed undo buffer, keyed by item id (PLAN.md §6).
pub struct UndoState(pub Mutex<HashMap<i64, UndoSlot>>);

impl Default for UndoState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

fn evict_expired(map: &mut HashMap<i64, UndoSlot>, ttl: Duration, now: Instant) {
    if ttl.is_zero() {
        map.clear();
        return;
    }
    map.retain(|_, slot| now.duration_since(slot.at) < ttl);
}

pub fn snapshot_content(conn: &Connection, node_id: i64) -> rusqlite::Result<Option<StoredContent>> {
    conn.query_row(
        "SELECT content_type, text_content, blob_path, blob_hash, byte_size, width, height
         FROM items WHERE node_id = ?1",
        [node_id],
        |row| {
            Ok(StoredContent {
                content_type: row.get(0)?,
                text_content: row.get(1)?,
                blob_path: row.get(2)?,
                blob_hash: row.get(3)?,
                byte_size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
            })
        },
    )
    .optional()
}

/// Overwrite an item's content. The `text_content` change fires the FTS trigger,
/// keeping the search index in sync.
pub fn set_content(conn: &Connection, node_id: i64, c: &StoredContent) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE items SET content_type=?2, text_content=?3, blob_path=?4, blob_hash=?5,
         byte_size=?6, width=?7, height=?8 WHERE node_id=?1",
        rusqlite::params![
            node_id,
            c.content_type,
            c.text_content,
            c.blob_path,
            c.blob_hash,
            c.byte_size,
            c.width,
            c.height
        ],
    )?;
    conn.execute(
        "UPDATE nodes SET updated_at=?2 WHERE id=?1",
        rusqlite::params![node_id, now_unix()],
    )?;
    Ok(())
}

/// Replace an item's content with `new`, stashing the previous content as the
/// single-level undo entry (unless the TTL disables undo).
pub fn overwrite_and_record(
    conn: &Connection,
    undo: &Mutex<HashMap<i64, UndoSlot>>,
    node_id: i64,
    new: &StoredContent,
    ttl: Duration,
) -> rusqlite::Result<()> {
    let previous = snapshot_content(conn, node_id)?;
    set_content(conn, node_id, new)?;
    if !ttl.is_zero() {
        if let Some(prev) = previous {
            let now = Instant::now();
            let mut map = undo.lock().expect("undo mutex");
            evict_expired(&mut map, ttl, now);
            map.insert(node_id, UndoSlot { undo: Some(prev), redo: None, at: now });
        }
    }
    Ok(())
}

/// Restore the previous content, stashing the current content as redo.
pub fn undo_paste(
    conn: &Connection,
    undo: &Mutex<HashMap<i64, UndoSlot>>,
    node_id: i64,
    ttl: Duration,
) -> rusqlite::Result<bool> {
    let now = Instant::now();
    let mut map = undo.lock().expect("undo mutex");
    evict_expired(&mut map, ttl, now);
    if let Some(slot) = map.get_mut(&node_id) {
        if let Some(prev) = slot.undo.take() {
            let current = snapshot_content(conn, node_id)?;
            set_content(conn, node_id, &prev)?;
            slot.redo = current;
            slot.at = now;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Re-apply the undone content, stashing the current content back as undo.
pub fn redo_paste(
    conn: &Connection,
    undo: &Mutex<HashMap<i64, UndoSlot>>,
    node_id: i64,
    ttl: Duration,
) -> rusqlite::Result<bool> {
    let now = Instant::now();
    let mut map = undo.lock().expect("undo mutex");
    evict_expired(&mut map, ttl, now);
    if let Some(slot) = map.get_mut(&node_id) {
        if let Some(next) = slot.redo.take() {
            let current = snapshot_content(conn, node_id)?;
            set_content(conn, node_id, &next)?;
            slot.undo = current;
            slot.at = now;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Populate a fresh database with a small sample tree so there is something to
/// browse during development (PLAN.md §11 milestone 2). No-op if the root
/// already has children.
pub fn seed_if_empty(
    conn: &mut Connection,
    blobs_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if !list_children(conn, None)?.is_empty() {
        return Ok(());
    }
    let greetings = create_group(conn, None, "Greetings")?;
    create_item(conn, Some(greetings.id), "Hello", &NewContent::Text {
        text: "Hello, world!".into(),
    })?;
    create_item(conn, Some(greetings.id), "Sign-off", &NewContent::Text {
        text: "Best regards,\nZ3ro".into(),
    })?;

    let snippets = create_group(conn, None, "Code Snippets")?;
    create_item(conn, Some(snippets.id), "Shrug", &NewContent::Text {
        text: r"¯\_(ツ)_/¯".into(),
    })?;
    let nested = create_group(conn, Some(snippets.id), "Rust")?;
    create_item(conn, Some(nested.id), "main", &NewContent::Text {
        text: "fn main() {\n    println!(\"hi\");\n}".into(),
    })?;

    let samples = create_group(conn, None, "Samples")?;
    let png = sample_png()?;
    let blob = blobs::store_bytes(blobs_dir, &png, "png")?;
    create_blob_item(conn, Some(samples.id), "Gradient", "image", &blob, Some((96, 64)))?;
    Ok(())
}

// ---- Tauri command wrappers ------------------------------------------------

#[tauri::command]
pub fn list_children_cmd(db: State<Db>, parent_id: Option<i64>) -> CmdResult<Vec<Node>> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    list_children(&conn, parent_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_node_cmd(db: State<Db>, id: i64) -> CmdResult<Node> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_node(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("node {id} not found"))
}

#[tauri::command]
pub fn search_cmd(db: State<Db>, query: String) -> CmdResult<Vec<SearchHit>> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    search(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_cmd(app: AppHandle, db: State<Db>) -> CmdResult<Vec<Node>> {
    let s = crate::settings::load(&app);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_recent(&conn, s.max_recent, s.recent_days * 86_400).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group_cmd(db: State<Db>, parent_id: Option<i64>, name: String) -> CmdResult<Node> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    create_group(&conn, parent_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_item_cmd(
    db: State<Db>,
    parent_id: Option<i64>,
    name: String,
    content: NewContent,
) -> CmdResult<Node> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    create_item(&mut conn, parent_id, &name, &content).map_err(|e| e.to_string())
}

fn app_blobs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("blobs"))
}

/// CMD+C — copy the item's content to the system clipboard (PLAN.md §6).
#[tauri::command]
pub fn copy_item_to_clipboard_cmd(app: AppHandle, db: State<Db>, item_id: i64) -> CmdResult<()> {
    let blobs_dir = app_blobs_dir(&app)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let content = snapshot_content(&conn, item_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("item {item_id} not found"))?;

    let read_blob = || -> Result<Vec<u8>, String> {
        let path = blobs_dir.join(content.blob_path.clone().unwrap_or_default());
        std::fs::read(path).map_err(|e| e.to_string())
    };
    match content.content_type.as_str() {
        "image" => clipboard::write_image_png(&read_blob()?),
        "gif" => clipboard::write_gif(&read_blob()?),
        _ => clipboard::write_text(&content.text_content.clone().unwrap_or_default()),
    }

    // Feeds Recent Items (PLAN.md §4).
    conn.execute(
        "UPDATE nodes SET last_used_at=?2 WHERE id=?1",
        rusqlite::params![item_id, now_unix()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// CMD+V — replace the item's content with the system clipboard (PLAN.md §6).
#[tauri::command]
pub fn paste_clipboard_into_item_cmd(
    app: AppHandle,
    db: State<Db>,
    undo: State<UndoState>,
    item_id: i64,
) -> CmdResult<()> {
    let blobs_dir = app_blobs_dir(&app)?;
    let pasted = clipboard::read().ok_or_else(|| "clipboard is empty or unsupported".to_string())?;

    let dims = |bytes: &[u8]| {
        image::load_from_memory(bytes)
            .ok()
            .map(|i| (i.width() as i64, i.height() as i64))
    };
    let new = match pasted {
        Pasteboard::Text(s) => StoredContent::text(s),
        Pasteboard::Image(png) => {
            let d = dims(&png);
            let blob = blobs::store_bytes(&blobs_dir, &png, "png").map_err(|e| e.to_string())?;
            StoredContent::blob("image", &blob, d)
        }
        Pasteboard::Gif(bytes) => {
            let d = dims(&bytes);
            let blob = blobs::store_bytes(&blobs_dir, &bytes, "gif").map_err(|e| e.to_string())?;
            StoredContent::blob("gif", &blob, d)
        }
    };

    let ttl = undo_ttl(&app);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    overwrite_and_record(&conn, &undo.0, item_id, &new, ttl).map_err(|e| e.to_string())
}

/// CMD+Z — restore the pre-paste content. Returns whether anything was undone.
#[tauri::command]
pub fn undo_paste_cmd(
    app: AppHandle,
    db: State<Db>,
    undo: State<UndoState>,
    item_id: i64,
) -> CmdResult<bool> {
    let ttl = undo_ttl(&app);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    undo_paste(&conn, &undo.0, item_id, ttl).map_err(|e| e.to_string())
}

/// CMD+Shift+Z — re-apply the undone content.
#[tauri::command]
pub fn redo_paste_cmd(
    app: AppHandle,
    db: State<Db>,
    undo: State<UndoState>,
    item_id: i64,
) -> CmdResult<bool> {
    let ttl = undo_ttl(&app);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    redo_paste(&conn, &undo.0, item_id, ttl).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_item_content_cmd(
    app: AppHandle,
    db: State<Db>,
    item_id: i64,
) -> CmdResult<ItemContent> {
    let blobs_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("blobs");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_item_content(&conn, &blobs_dir, item_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("item {item_id} not found"))
}

/// Create an image or gif item from a file on disk (chosen via the add modal's
/// file picker). GIFs keep their raw bytes to preserve animation; other images
/// are transcoded to PNG for a consistent still representation.
#[tauri::command]
pub fn create_file_item_cmd(
    app: AppHandle,
    db: State<Db>,
    parent_id: Option<i64>,
    name: String,
    path: String,
) -> CmdResult<Node> {
    let blobs_dir = app_blobs_dir(&app)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let dims = image::load_from_memory(&bytes)
        .ok()
        .map(|i| (i.width() as i64, i.height() as i64));
    let is_gif = bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a");

    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let node = if is_gif {
        let blob = blobs::store_bytes(&blobs_dir, &bytes, "gif").map_err(|e| e.to_string())?;
        create_blob_item(&mut conn, parent_id, &name, "gif", &blob, dims)
    } else {
        let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        let blob = blobs::store_bytes(&blobs_dir, &png, "png").map_err(|e| e.to_string())?;
        create_blob_item(&mut conn, parent_id, &name, "image", &blob, dims)
    };
    node.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_node_cmd(db: State<Db>, id: i64, name: String) -> CmdResult<()> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    rename_node(&conn, id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_node_cmd(db: State<Db>, id: i64) -> CmdResult<()> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    delete_node(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_node_cmd(
    db: State<Db>,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: i64,
) -> CmdResult<()> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    move_node(&conn, id, new_parent_id, new_position).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn text(t: &str) -> NewContent {
        NewContent::Text { text: t.to_string() }
    }

    /// Item nodes matching a full-text query, ranked name-first (PLAN.md §4).
    fn search_ids(conn: &Connection, query: &str) -> Vec<i64> {
        let mut stmt = conn
            .prepare(
                "SELECT rowid FROM item_search WHERE item_search MATCH ?1
                 ORDER BY bm25(item_search, 10.0, 1.0)",
            )
            .unwrap();
        stmt.query_map([query], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<i64>>>()
            .unwrap()
    }

    #[test]
    fn tree_crud_roundtrip() {
        let mut conn = db::open_in_memory().unwrap();

        let group = create_group(&conn, None, "Group A").unwrap();
        assert_eq!(group.kind, "group");
        let item = create_item(&mut conn, Some(group.id), "Item X", &text("hello")).unwrap();
        assert_eq!(item.parent_id, Some(group.id));

        // Positions increment within a parent.
        let item2 = create_item(&mut conn, Some(group.id), "Item Y", &text("world")).unwrap();
        assert_eq!(item.position, 0);
        assert_eq!(item2.position, 1);

        assert_eq!(list_children(&conn, None).unwrap().len(), 1);
        assert_eq!(list_children(&conn, Some(group.id)).unwrap().len(), 2);

        rename_node(&conn, item.id, "Renamed X").unwrap();
        assert_eq!(get_node(&conn, item.id).unwrap().unwrap().name, "Renamed X");

        // Move Item Y out to the root.
        move_node(&conn, item2.id, None, 5).unwrap();
        assert_eq!(list_children(&conn, None).unwrap().len(), 2);
        assert_eq!(list_children(&conn, Some(group.id)).unwrap().len(), 1);
    }

    #[test]
    fn fts_indexes_and_syncs() {
        let mut conn = db::open_in_memory().unwrap();
        let group = create_group(&conn, None, "Snippets").unwrap();
        let item = create_item(
            &mut conn,
            Some(group.id),
            "Greeting",
            &text("hello wonderful world"),
        )
        .unwrap();

        // Indexed by both name and content.
        assert_eq!(search_ids(&conn, "Greeting"), vec![item.id]);
        assert_eq!(search_ids(&conn, "wonderful"), vec![item.id]);

        // Renaming the node reindexes the name column.
        rename_node(&conn, item.id, "Salutation").unwrap();
        assert!(search_ids(&conn, "Greeting").is_empty());
        assert_eq!(search_ids(&conn, "Salutation"), vec![item.id]);

        // Groups are never indexed as searchable items.
        assert!(search_ids(&conn, "Snippets").is_empty());
    }

    #[test]
    fn name_matches_outrank_content_matches() {
        let mut conn = db::open_in_memory().unwrap();
        // "keyword" appears in one item's name, another's content only.
        let content_hit =
            create_item(&mut conn, None, "Notes", &text("a keyword appears here")).unwrap();
        let name_hit = create_item(&mut conn, None, "keyword", &text("nothing relevant")).unwrap();

        let ranked = search_ids(&conn, "keyword");
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0], name_hit.id, "name match should rank first");
        assert_eq!(ranked[1], content_hit.id);
    }

    fn temp_blobs_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("acm-test-blobs-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn text_content_roundtrips() {
        let mut conn = db::open_in_memory().unwrap();
        let blobs_dir = temp_blobs_dir();
        let item = create_item(&mut conn, None, "Note", &text("multi\nline")).unwrap();
        match get_item_content(&conn, &blobs_dir, item.id).unwrap().unwrap() {
            ItemContent::Text { text } => assert_eq!(text, "multi\nline"),
            other => panic!("expected text, got {other:?}"),
        }
    }

    #[test]
    fn blob_storage_dedups_and_reads_back() {
        let mut conn = db::open_in_memory().unwrap();
        let blobs_dir = temp_blobs_dir();

        let data = b"pretend-png-bytes";
        let a = crate::blobs::store_bytes(&blobs_dir, data, "png").unwrap();
        let b = crate::blobs::store_bytes(&blobs_dir, data, "png").unwrap();
        // Same content -> same hash/path, one file on disk.
        assert_eq!(a.rel_path, b.rel_path);
        assert_eq!(std::fs::read_dir(&blobs_dir).unwrap().count(), 1);

        let item = create_blob_item(&mut conn, None, "Pic", "image", &a, Some((96, 64))).unwrap();
        match get_item_content(&conn, &blobs_dir, item.id).unwrap().unwrap() {
            ItemContent::Image { path, width, height } => {
                assert!(path.ends_with(&a.rel_path));
                assert_eq!((width, height), (Some(96), Some(64)));
            }
            other => panic!("expected image, got {other:?}"),
        }
        std::fs::remove_dir_all(&blobs_dir).ok();
    }

    fn image_content() -> StoredContent {
        let blob = crate::blobs::BlobInfo {
            rel_path: "deadbeef.png".into(),
            hash: "deadbeef".into(),
            byte_size: 128,
        };
        StoredContent::blob("image", &blob, Some((32, 32)))
    }

    #[test]
    fn paste_undo_redo_swaps_content_and_reindexes() {
        let mut conn = db::open_in_memory().unwrap();
        let ttl = std::time::Duration::from_secs(600);
        let undo = std::sync::Mutex::new(std::collections::HashMap::new());
        let item = create_item(&mut conn, None, "Note", &text("original words")).unwrap();

        // Paste an image over the text item.
        overwrite_and_record(&conn, &undo, item.id, &image_content(), ttl).unwrap();
        assert_eq!(
            snapshot_content(&conn, item.id).unwrap().unwrap().content_type,
            "image"
        );
        assert!(search_ids(&conn, "original").is_empty(), "text should be de-indexed");

        // Undo -> text is back and searchable again.
        assert!(undo_paste(&conn, &undo, item.id, ttl).unwrap());
        assert_eq!(search_ids(&conn, "original"), vec![item.id]);

        // Redo -> image again.
        assert!(redo_paste(&conn, &undo, item.id, ttl).unwrap());
        assert!(search_ids(&conn, "original").is_empty());

        // Undo is single-level: a second undo after redo restores text once more,
        // but there is no second history step beyond that.
        assert!(undo_paste(&conn, &undo, item.id, ttl).unwrap());
        assert!(!undo_paste(&conn, &undo, item.id, ttl).unwrap());
    }

    #[test]
    fn search_returns_hits_with_breadcrumb() {
        let mut conn = db::open_in_memory().unwrap();
        let snippets = create_group(&conn, None, "Code Snippets").unwrap();
        let rust = create_group(&conn, Some(snippets.id), "Rust").unwrap();
        let item = create_item(&mut conn, Some(rust.id), "main fn", &text("println")).unwrap();

        let hits = search(&conn, "main").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, item.id);
        assert_eq!(hits[0].path, "Code Snippets / Rust");

        // Content is searchable too, and arbitrary punctuation doesn't break MATCH.
        assert_eq!(search(&conn, "println").unwrap().len(), 1);
        assert!(search(&conn, "  \"weird( input").unwrap().is_empty());
    }

    #[test]
    fn recent_reflects_last_used_and_limits() {
        let mut conn = db::open_in_memory().unwrap();
        let a = create_item(&mut conn, None, "A", &text("a")).unwrap();
        let b = create_item(&mut conn, None, "B", &text("b")).unwrap();

        // Nothing used yet.
        assert!(get_recent(&conn, 25, 0).unwrap().is_empty());

        // Mark A then B used; B is more recent.
        conn.execute("UPDATE nodes SET last_used_at = 100 WHERE id = ?1", [a.id]).unwrap();
        conn.execute("UPDATE nodes SET last_used_at = 200 WHERE id = ?1", [b.id]).unwrap();
        let recent = get_recent(&conn, 25, 0).unwrap();
        assert_eq!(recent.iter().map(|n| n.id).collect::<Vec<_>>(), vec![b.id, a.id]);

        // max == 0 disables the list.
        assert!(get_recent(&conn, 0, 0).unwrap().is_empty());
    }

    #[test]
    fn undo_disabled_when_ttl_zero() {
        let mut conn = db::open_in_memory().unwrap();
        let undo = std::sync::Mutex::new(std::collections::HashMap::new());
        let item = create_item(&mut conn, None, "N", &text("hi")).unwrap();

        overwrite_and_record(
            &conn,
            &undo,
            item.id,
            &StoredContent::text("bye".into()),
            std::time::Duration::ZERO,
        )
        .unwrap();
        // Content changed, but nothing is retained to undo.
        assert_eq!(
            snapshot_content(&conn, item.id).unwrap().unwrap().text_content,
            Some("bye".into())
        );
        assert!(!undo_paste(&conn, &undo, item.id, std::time::Duration::ZERO).unwrap());
    }

    #[test]
    fn cascade_delete_cleans_search_index() {
        let mut conn = db::open_in_memory().unwrap();
        let group = create_group(&conn, None, "Parent").unwrap();
        let child = create_group(&conn, Some(group.id), "Child").unwrap();
        let item = create_item(&mut conn, Some(child.id), "Deep", &text("buried treasure")).unwrap();
        assert_eq!(search_ids(&conn, "treasure"), vec![item.id]);

        // Deleting the top group must cascade to the nested item and clear FTS.
        delete_node(&conn, group.id).unwrap();
        assert!(get_node(&conn, item.id).unwrap().is_none());
        assert!(
            search_ids(&conn, "treasure").is_empty(),
            "cascaded delete left a stale FTS row"
        );
    }
}
