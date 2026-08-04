use serde::{Deserialize, Serialize};

/// A node in the tree — either a `group` or an `item` (PLAN.md §4).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub kind: String,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
}

/// Content supplied from the frontend when creating an item. Image/gif items
/// are produced by pasting (M5) or seeding, not via this JS-facing enum.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum NewContent {
    Text { text: String },
}

/// A ranked search result: an item plus a breadcrumb of its ancestor groups
/// (PLAN.md §4, §5.2).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: i64,
    pub name: String,
    pub path: String,
}

/// An item's stored content, returned to the frontend for display (PLAN.md §5.5,
/// §8). Blob variants carry the absolute filesystem path so the frontend can
/// render them through the Tauri asset protocol (`convertFileSrc`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ItemContent {
    Text {
        text: String,
        /// Pinned highlight.js language id, or null to auto-detect at render.
        language: Option<String>,
    },
    Image {
        path: String,
        width: Option<i64>,
        height: Option<i64>,
    },
    Gif {
        path: String,
        width: Option<i64>,
        height: Option<i64>,
    },
}
