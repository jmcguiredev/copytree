use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension};
use tauri::{AppHandle, Manager, State};

use crate::blobs::{self, BlobInfo};
use crate::db::Db;
use crate::models::{ItemContent, NewContent, Node};

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
