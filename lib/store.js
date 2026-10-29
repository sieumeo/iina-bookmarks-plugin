// Persistence for bookmarks, kept in the plugin's private data folder.
//
// Layout of @data/bookmarks.json:
//   { version: 1, files: { "<media url>": { url, name, duration, updatedAt, bookmarks: [...] } } }
// Bookmark: { id, time, title, note, createdAt, hasThumb }
// Thumbnails live next to it as @data/thumb-<id>.txt (a small JPEG data URL).
//
// Every IINA window runs its own plugin instance, so the file is re-read before each
// change (read-modify-write) to avoid one window overwriting another's bookmarks.

const DB_PATH = "@data/bookmarks.json";

function createStore(file, console) {
  function emptyDb() {
    return { version: 1, files: {} };
  }

  function load() {
    if (!file.exists(DB_PATH)) return emptyDb();
    try {
      const db = JSON.parse(file.read(DB_PATH) || "");
      if (!db || typeof db.files !== "object") return emptyDb();
      return db;
    } catch (e) {
      console.error("Bookmarks: cannot parse " + DB_PATH + ": " + e);
      // Keep the broken file around instead of silently losing data.
      try {
        file.write("@data/bookmarks.broken-" + Date.now() + ".json", file.read(DB_PATH) || "");
      } catch (e2) {}
      return emptyDb();
    }
  }

  function save(db) {
    file.write(DB_PATH, JSON.stringify(db, null, 1));
  }

  function getEntry(url) {
    const db = load();
    return db.files[url] || null;
  }

  function getBookmarks(url) {
    const entry = getEntry(url);
    return entry ? entry.bookmarks.slice() : [];
  }

  // Apply `mutator(bookmarks) -> bookmarks` to one media entry and persist.
  function update(url, meta, mutator) {
    const db = load();
    const entry = db.files[url] || { url: url, bookmarks: [] };
    if (meta) {
      if (meta.name) entry.name = meta.name;
      if (meta.duration) entry.duration = meta.duration;
    }
    entry.bookmarks = mutator(entry.bookmarks.slice()).sort((a, b) => a.time - b.time);
    entry.updatedAt = Date.now();
    if (entry.bookmarks.length === 0) delete db.files[url];
    else db.files[url] = entry;
    save(db);
    return entry.bookmarks;
  }

  function allEntries() {
    const db = load();
    return Object.keys(db.files)
      .map((k) => db.files[k])
      .filter((e) => e.bookmarks && e.bookmarks.length > 0)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function thumbPath(id) {
    return "@data/thumb-" + id + ".txt";
  }

  function readThumb(id) {
    const p = thumbPath(id);
    if (!file.exists(p)) return null;
    try {
      return file.read(p) || null;
    } catch (e) {
      return null;
    }
  }

  function writeThumb(id, dataUrl) {
    file.write(thumbPath(id), dataUrl);
  }

  function deleteThumb(id) {
    const p = thumbPath(id);
    try {
      if (file.exists(p)) file.delete(p);
    } catch (e) {}
  }

  return { load, getEntry, getBookmarks, update, allEntries, readThumb, writeThumb, deleteThumb };
}

module.exports = { createStore };
