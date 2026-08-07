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

/// Rewrite `nodes.position` from INTEGER to a TEXT fractional-index key
/// (`rank.rs`). We can't change a column's affinity in place, so add a TEXT
/// column, re-rank each parent's children by their old integer order, then drop
/// the old column and rename. The `idx_nodes_parent` index over `position` must
/// be dropped first (a column can't be dropped while indexed) and recreated.
/// On a fresh install the table is empty, so this just swaps the column type.
fn migrate_v3(conn: &Connection) -> rusqlite::Result<()> {
    // All-or-nothing: SQLite DDL is transactional, so a crash mid-migration
    // rolls back and the next launch retries from a clean v2 schema.
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("ALTER TABLE nodes ADD COLUMN position_txt TEXT;")?;

    // Distinct parents (including the NULL root), then re-rank each group's
    // children in their existing order by appending keys one after another.
    let parents: Vec<Option<i64>> = {
        let mut stmt = tx.prepare("SELECT DISTINCT parent_id FROM nodes")?;
        let rows = stmt.query_map([], |r| r.get::<_, Option<i64>>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for parent in parents {
        let ids: Vec<i64> = {
            let mut stmt =
                tx.prepare("SELECT id FROM nodes WHERE parent_id IS ?1 ORDER BY position, id")?;
            let rows = stmt.query_map([parent], |r| r.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut prev: Option<String> = None;
        for id in ids {
            let key = crate::rank::key_between(prev.as_deref(), None);
            tx.execute(
                "UPDATE nodes SET position_txt = ?1 WHERE id = ?2",
                rusqlite::params![key, id],
            )?;
            prev = Some(key);
        }
    }

    tx.execute_batch(
        "DROP INDEX IF EXISTS idx_nodes_parent;
         ALTER TABLE nodes DROP COLUMN position;
         ALTER TABLE nodes RENAME COLUMN position_txt TO position;
         CREATE INDEX idx_nodes_parent ON nodes(parent_id, position);",
    )?;
    tx.commit()
}

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
    if version < 3 {
        migrate_v3(conn)?;
        conn.pragma_update(None, "user_version", 3)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_v3_converts_integer_positions_preserving_order() {
        // Simulate a pre-v3 install: schema v1+v2 with INTEGER positions.
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(SCHEMA_V2).unwrap();
        conn.pragma_update(None, "user_version", 2).unwrap();
        // A group with two children whose integer positions are out of id order
        // (id 2 = "B" at 20, id 3 = "A" at 10 → sorted order is A then B).
        conn.execute_batch(
            "INSERT INTO nodes (id,parent_id,kind,name,position,created_at,updated_at)
               VALUES (1,NULL,'group','G',0,0,0),
                      (2,1,'item','B',20,0,0),
                      (3,1,'item','A',10,0,0);
             INSERT INTO items (node_id,content_type,text_content)
               VALUES (2,'text','b'),(3,'text','a');",
        )
        .unwrap();

        migrate(&conn).unwrap();

        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 3, "migration bumps user_version");

        // Ordering by the now-TEXT position preserves the old integer order.
        let mut stmt = conn
            .prepare("SELECT name FROM nodes WHERE parent_id = 1 ORDER BY position")
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(names, ["A", "B"]);

        // Positions are non-empty fractional-index text keys, and A sorts before B.
        let pos_a: String = conn
            .query_row("SELECT position FROM nodes WHERE id = 3", [], |r| r.get(0))
            .unwrap();
        let pos_b: String = conn
            .query_row("SELECT position FROM nodes WHERE id = 2", [], |r| r.get(0))
            .unwrap();
        assert!(!pos_a.is_empty() && pos_a < pos_b);

        // The index over (parent_id, position) was recreated.
        let has_index: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_nodes_parent'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_index, 1);
    }
}
