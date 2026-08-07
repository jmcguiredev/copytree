//! Import / export of the two persistent artifacts, each independently:
//! - **Settings** (`settings.json`) as a plain JSON file.
//! - **Database** (the item tree) as a `.zip` bundling `copytree.db` **and** the
//!   `blobs/` directory, so image/gif items survive a round-trip.
//!
//! The frontend picks the source/destination path with a native dialog and hands
//! it to these commands, which do the filesystem work. Database import replaces
//! the files and swaps the managed connection in place (no restart needed).

use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::db::{self, Db};
use crate::settings::STORE_PATH;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Copy the current `settings.json` to a user-chosen path.
#[tauri::command]
pub fn export_settings(app: AppHandle, dest: String) -> Result<(), String> {
    // Flush any pending in-memory store writes so the file is current.
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    store.save().map_err(|e| e.to_string())?;
    let src = data_dir(&app)?.join(STORE_PATH);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Merge a settings JSON file into the store (each top-level key overwrites).
/// The frontend re-reads + re-applies afterwards (and re-registers the hotkey).
#[tauri::command]
pub fn import_settings(app: AppHandle, src: String) -> Result<(), String> {
    let text = fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("not valid JSON: {e}"))?;
    let obj = value
        .as_object()
        .ok_or("settings file must be a JSON object")?;
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    for (k, v) in obj {
        store.set(k, v.clone());
    }
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Bundle `copytree.db` + `blobs/*` into a zip at `dest`. Holds the DB lock so the
/// snapshot is taken between transactions (the file on disk is then consistent).
#[tauri::command]
pub fn export_database(app: AppHandle, db: State<Db>, dest: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let db_path = dir.join("copytree.db");
    let blobs_dir = dir.join("blobs");

    let _guard = db.0.lock().map_err(|e| e.to_string())?;
    let file = File::create(&dest).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("copytree.db", opts).map_err(|e| e.to_string())?;
    zip.write_all(&fs::read(&db_path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    if blobs_dir.is_dir() {
        for entry in fs::read_dir(&blobs_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let name = format!("blobs/{}", entry.file_name().to_string_lossy());
                zip.start_file(name, opts).map_err(|e| e.to_string())?;
                zip.write_all(&fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Restore a database export: extract `copytree.db` + `blobs/*` over the app data dir
/// (replacing them) and reopen the managed connection on the new file. Only our
/// own entries are extracted, and any traversal (`..`) entry is skipped.
#[tauri::command]
pub fn import_database(app: AppHandle, db: State<Db>, src: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let db_path = dir.join("copytree.db");

    // Hold the lock across extraction + reopen so no query runs on a half-written
    // file; the old connection is dropped (closed) when we overwrite `*guard`.
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    let file = File::open(&src).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = f.name().replace('\\', "/");
        let ours = name == "copytree.db" || name.starts_with("blobs/");
        if !ours || name.contains("..") || name.ends_with('/') {
            continue;
        }
        let out_path = dir.join(&name);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut out).map_err(|e| e.to_string())?;
    }

    *guard = db::open(&db_path).map_err(|e| e.to_string())?;
    Ok(())
}
