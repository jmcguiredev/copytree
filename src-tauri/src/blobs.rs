use std::path::Path;

use sha2::{Digest, Sha256};

/// Result of storing a payload under `blobs/` (PLAN.md §4).
pub struct BlobInfo {
    /// File name relative to the blobs directory, `<sha256>.<ext>`.
    pub rel_path: String,
    pub hash: String,
    pub byte_size: i64,
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Write `data` to `blobs/<sha256>.<ext>`, deduplicating by content hash: if a
/// blob with the same hash already exists it is reused rather than rewritten.
pub fn store_bytes(blobs_dir: &Path, data: &[u8], ext: &str) -> std::io::Result<BlobInfo> {
    let hash = hex(&Sha256::digest(data));
    let rel_path = format!("{hash}.{ext}");
    let path = blobs_dir.join(&rel_path);
    if !path.exists() {
        std::fs::create_dir_all(blobs_dir)?;
        std::fs::write(&path, data)?;
    }
    Ok(BlobInfo {
        rel_path,
        hash,
        byte_size: data.len() as i64,
    })
}
