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

/// Content supplied when creating an item. Image/gif variants arrive with the
/// blob-storage work in milestone 4; only text is wired up so far.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum NewContent {
    Text { text: String },
}
