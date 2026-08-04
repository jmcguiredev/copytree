use std::sync::Mutex;

use rusqlite::Connection;

/// Tauri-managed database handle. `rusqlite::Connection` is `Send` but not
/// `Sync`, so it is wrapped in a `Mutex` to satisfy Tauri's state bounds.
pub struct Db(pub Mutex<Connection>);

/// Schema version 1. Adjacency-list tree (`nodes`), item content (`items`),
/// and a full-text index (`item_search`) kept in sync by triggers.
///
/// PLAN.md §4 specifies a *contentless* FTS5 table fed by triggers. We instead
/// use a regular (content-storing) FTS5 table: keeping a contentless index in
/// sync requires the original indexed values to delete a row, and here `name`
/// lives in `nodes` while `content` lives in `items`, so a trigger on one table
/// never has the other's old value. A regular table deletes/updates by rowid
/// with plain SQL. The storage overhead is trivial at personal scale and the
/// `bm25(item_search, 10.0, 1.0)` name-weighted ranking is unchanged.
const SCHEMA_V1: &str = r#"
CREATE TABLE nodes (
  id           INTEGER PRIMARY KEY,
  parent_id    INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('group','item')),
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_nodes_parent ON nodes(parent_id, position);
CREATE INDEX idx_nodes_recent ON nodes(last_used_at);

CREATE TABLE items (
  node_id      INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('text','image','gif')),
  text_content TEXT,
  blob_path    TEXT,
  blob_hash    TEXT,
  byte_size    INTEGER,
  width        INTEGER,
  height       INTEGER
);

-- Full-text index over item nodes only. rowid = node id.
-- Column order (name, content) is what makes bm25 weighting name-first work.
CREATE VIRTUAL TABLE item_search USING fts5(name, content, tokenize='unicode61');

-- An item node's search row is created when the node row appears (content is
-- filled in when the matching items row arrives), renamed with the node, and
-- removed when the node is deleted (including via ON DELETE CASCADE).
CREATE TRIGGER nodes_search_ai AFTER INSERT ON nodes WHEN new.kind = 'item' BEGIN
  INSERT INTO item_search(rowid, name, content) VALUES (new.id, new.name, '');
END;
CREATE TRIGGER nodes_search_au AFTER UPDATE OF name ON nodes WHEN new.kind = 'item' BEGIN
  UPDATE item_search SET name = new.name WHERE rowid = new.id;
END;
CREATE TRIGGER nodes_search_ad AFTER DELETE ON nodes WHEN old.kind = 'item' BEGIN
  DELETE FROM item_search WHERE rowid = old.id;
END;

-- Item text feeds the `content` column of its search row.
CREATE TRIGGER items_search_ai AFTER INSERT ON items BEGIN
  UPDATE item_search SET content = COALESCE(new.text_content, '') WHERE rowid = new.node_id;
END;
CREATE TRIGGER items_search_au AFTER UPDATE OF text_content ON items BEGIN
  UPDATE item_search SET content = COALESCE(new.text_content, '') WHERE rowid = new.node_id;
END;
"#;

/// Per-connection pragmas. `foreign_keys` enables the cascade; `recursive_triggers`
/// makes those cascaded deletes fire the `nodes_search_ad` trigger so the FTS
/// index does not retain rows for descendants of a deleted group.
pub fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "recursive_triggers", true)?;
    Ok(())
}

/// Schema version 2: syntax-highlighting language for text items. NULL means
/// auto-detect at render (a highlight.js `highlightAuto`); a non-null value is a
/// language id the user pinned. Never edit SCHEMA_V1 for existing installs.
const SCHEMA_V2: &str = "ALTER TABLE items ADD COLUMN language TEXT;";

/// Apply pending migrations, tracked via `PRAGMA user_version`.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    if version < 2 {
        conn.execute_batch(SCHEMA_V2)?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    Ok(())
}

/// Open (or create) the database at `path`, configure it, and migrate.
pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}
