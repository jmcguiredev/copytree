//! Native macOS pasteboard read/write (PLAN.md §6). Text and still images go
//! through the typed pasteboard; animated GIFs are written as raw bytes under
//! the `com.compuserve.gif` UTI with a still PNG fallback so bitmap-only
//! consumers still get a frame. Follows arboard's pattern of `clearContents`
//! then `setData:forType:` (no legacy `declareTypes:` needed on modern macOS).

use std::io::Cursor;

use objc2_app_kit::{
    NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF,
};
use objc2_foundation::{NSData, NSString};

/// UTI for animated GIF data on the pasteboard.
const UTI_GIF: &str = "com.compuserve.gif";

/// What we found on the pasteboard when pasting, in priority order.
pub enum Pasteboard {
    Gif(Vec<u8>),
    /// PNG-encoded still image bytes.
    Image(Vec<u8>),
    Text(String),
}

/// Write plain text to the system clipboard.
pub fn write_text(text: &str) {
    let pb = NSPasteboard::generalPasteboard();
    pb.clearContents();
    pb.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
}

/// Write a still image (given as PNG bytes) as PNG + TIFF representations.
pub fn write_image_png(png: &[u8]) {
    let pb = NSPasteboard::generalPasteboard();
    pb.clearContents();
    pb.setData_forType(Some(&NSData::with_bytes(png)), unsafe { NSPasteboardTypePNG });
    if let Ok(img) = image::load_from_memory(png) {
        let mut tiff = Vec::new();
        if img
            .write_to(&mut Cursor::new(&mut tiff), image::ImageFormat::Tiff)
            .is_ok()
        {
            pb.setData_forType(Some(&NSData::with_bytes(&tiff)), unsafe { NSPasteboardTypeTIFF });
        }
    }
}

/// Write animated GIF bytes under the GIF UTI, plus a still PNG first-frame
/// fallback. Whether the animation survives depends on the destination app.
pub fn write_gif(gif: &[u8]) {
    let pb = NSPasteboard::generalPasteboard();
    pb.clearContents();
    pb.setData_forType(Some(&NSData::with_bytes(gif)), &NSString::from_str(UTI_GIF));
    if let Ok(img) = image::load_from_memory(gif) {
        let mut png = Vec::new();
        if img
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .is_ok()
        {
            pb.setData_forType(Some(&NSData::with_bytes(&png)), unsafe { NSPasteboardTypePNG });
        }
    }
}

/// Read the system clipboard, preferring gif → image → text (PLAN.md §6).
/// Image data is normalized to PNG bytes for storage.
pub fn read() -> Option<Pasteboard> {
    let pb = NSPasteboard::generalPasteboard();

    if let Some(data) = pb.dataForType(&NSString::from_str(UTI_GIF)) {
        return Some(Pasteboard::Gif(data.to_vec()));
    }
    if let Some(data) = pb.dataForType(unsafe { NSPasteboardTypePNG }) {
        return Some(Pasteboard::Image(data.to_vec()));
    }
    if let Some(data) = pb.dataForType(unsafe { NSPasteboardTypeTIFF }) {
        if let Ok(img) = image::load_from_memory(&data.to_vec()) {
            let mut png = Vec::new();
            if img
                .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
                .is_ok()
            {
                return Some(Pasteboard::Image(png));
            }
        }
    }
    if let Some(s) = pb.stringForType(unsafe { NSPasteboardTypeString }) {
        return Some(Pasteboard::Text(s.to_string()));
    }
    None
}
