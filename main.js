// IINA Bookmarks: main entry (one instance per player window).

const { core, mpv, event, menu, sidebar, preferences, utils, file, console } = iina;
const util = require("./lib/util.js");
const { createStore } = require("./lib/store.js");

const store = createStore(file, console);

const DEFAULT_KEYS = {
  keyAdd: "Meta+b",
  keyAddNamed: "Meta+B",
  keyDelete: "Meta+BS",
  keyPrev: "Alt+Meta+LEFT",
  keyNext: "Alt+Meta+RIGHT",
  keyManager: "Alt+Meta+b",
};

const state = {
  url: null,
  bookmarks: [],
  originalChapters: [],
  chaptersTouched: false,
  sidebarReady: false,
  pendingThumbs: {}, // id -> { tmp, url } waiting for the sidebar to downscale it
  pendingSeek: null, // { url, time } after opening another file from the manager
  lastJumpId: null,
  lastPostedPosition: null,
};

// ---------------------------------------------------------------------------
// Helpers

function pref(key, fallback) {
  const v = preferences.get(key);
  return v === undefined || v === null || v === "" ? fallback : v;
}

function osd(message) {
  if (pref("showOsd", true)) core.osd(message);
}

function hasFile() {
  return !!state.url && !core.status.idle;
}

function position() {
  const p = core.status.position;
  return typeof p === "number" ? p : 0;
}

function label(b) {
  return b.title ? b.title : "Bookmark at " + util.formatTime(b.time);
}

function mediaMeta() {
  return {
    name: core.status.title || util.fileNameFromUrl(state.url),
    duration: core.status.duration || 0,
  };
}

// Plugin -> webview messages are injected by IINA into a String.raw`...` template,
// so a backtick in a bookmark title would break them. URI-encoding the JSON avoids that.
function post(name, payload) {
  if (!state.sidebarReady) return;
  sidebar.postMessage(name, { d: encodeURIComponent(JSON.stringify(payload)) });
}

// ---------------------------------------------------------------------------
// Bookmark operations

function addBookmark(title) {
  if (!hasFile()) return osd("Bookmarks: no file is playing");
  const pos = position();
  if (util.findNearest(state.bookmarks, pos, 0.5)) return osd("A bookmark already exists here");

  const bm = {
    id: util.makeId(),
    time: Math.round(pos * 1000) / 1000,
    title: title || "",
    note: "",
    createdAt: Date.now(),
    hasThumb: false,
  };
  state.bookmarks = store.update(state.url, mediaMeta(), (list) => list.concat([bm]));
  state.lastJumpId = bm.id;
  refresh();
  osd("Bookmark added: " + label(bm) + " (" + util.formatTime(bm.time) + ")");
  captureThumb(bm.id);
}

function addNamedBookmark() {
  if (!hasFile()) return osd("Bookmarks: no file is playing");
  const wasPaused = core.status.paused;
  if (!wasPaused) core.pause();
  const title = utils.prompt("Bookmark title (at " + util.formatTime(position()) + ")");
  if (!wasPaused) core.resume();
  if (title === undefined || title === null) return; // cancelled
  addBookmark(String(title).trim());
}

function updateBookmark(url, id, changes) {
  url = url || state.url;
  const list = store.update(url, null, (bms) =>
    bms.map((b) => {
      if (b.id !== id) return b;
      const n = Object.assign({}, b);
      if (typeof changes.title === "string") n.title = changes.title.trim();
      if (typeof changes.note === "string") n.note = changes.note;
      if (typeof changes.time === "number" && changes.time >= 0) n.time = changes.time;
      return n;
    })
  );
  if (url === state.url) state.bookmarks = list;
  refresh();
}

function deleteBookmark(url, id) {
  url = url || state.url;
  let removed = null;
  const list = store.update(url, null, (bms) =>
    bms.filter((b) => {
      if (b.id === id) removed = b;
      return b.id !== id;
    })
  );
  store.deleteThumb(id);
  if (url === state.url) state.bookmarks = list;
  if (state.lastJumpId === id) state.lastJumpId = null;
  refresh();
  if (removed) osd("Bookmark deleted: " + label(removed));
}

// Hotkey delete: the bookmark we just jumped to / added, or the nearest one within 3 s.
function deleteAtPosition() {
  if (!hasFile()) return;
  const pos = position();
  let target = null;
  if (state.lastJumpId) {
    const b = state.bookmarks.find((x) => x.id === state.lastJumpId);
    if (b && Math.abs(b.time - pos) <= 5) target = b;
  }
  if (!target) target = util.findNearest(state.bookmarks, pos, 3);
  if (!target) return osd("No bookmark near " + util.formatTime(pos));
  deleteBookmark(state.url, target.id);
}

function clearFile(url) {
  url = url || state.url;
  const entry = store.getEntry(url);
  if (!entry || entry.bookmarks.length === 0) return;
  const name = entry.name || util.fileNameFromUrl(url);
  if (!utils.ask("Delete all " + entry.bookmarks.length + " bookmarks for “" + name + "”?")) return;
  entry.bookmarks.forEach((b) => store.deleteThumb(b.id));
  store.update(url, null, () => []);
  if (url === state.url) state.bookmarks = [];
  refresh();
}

function jumpTo(b) {
  if (!b) return;
  core.seekTo(b.time);
  state.lastJumpId = b.id;
  osd(label(b) + "  " + util.formatTime(b.time));
}

function goNext() {
  if (!hasFile()) return;
  const b = util.findNext(state.bookmarks, position());
  if (b) jumpTo(b);
  else osd(state.bookmarks.length ? "No next bookmark" : "No bookmarks in this file");
}

function goPrevious() {
  if (!hasFile()) return;
  const b = util.findPrevious(state.bookmarks, position());
  if (b) jumpTo(b);
  else osd(state.bookmarks.length ? "No previous bookmark" : "No bookmarks in this file");
}

function openManager() {
  if (!core.window.loaded) return;
  sidebar.show();
}

function openFileAt(url, time) {
  if (url === state.url) {
    core.seekTo(time);
    return;
  }
  state.pendingSeek = { url: url, time: time };
  core.open(url);
}

// ---------------------------------------------------------------------------
// Timeline markers: bookmarks are merged into mpv's chapter list, which IINA draws as
// ticks on the progress bar (requires Settings > UI > "Show chapter positions").

function applyChapters() {
  if (!hasFile()) return;
  const enabled = pref("showOnTimeline", true);
  const marks = enabled ? state.bookmarks : [];
  if (marks.length === 0 && !state.chaptersTouched) return; // nothing of ours to add or remove
  const list = util.buildChapterList(state.originalChapters, marks, core.status.duration);
  try {
    mpv.set("chapter-list", list);
    core.getChapters(); // makes IINA reload its chapter cache and redraw the slider
    state.chaptersTouched = marks.length > 0;
  } catch (e) {
    console.warn("Bookmarks: cannot update chapter list: " + e);
  }
}

// ---------------------------------------------------------------------------
// Thumbnails: mpv writes a full-size frame to @tmp, the sidebar webview downsizes it
// with a canvas and sends back a small JPEG data URL, which is stored in @data.

function captureThumb(id) {
  if (!pref("captureThumbnails", true)) return;
  if (!core.status.videoWidth) return; // audio-only file
  const tmp = "@tmp/shot-" + id + ".jpg";
  const abs = utils.resolvePath(tmp);
  if (!abs) return;
  try {
    mpv.command("screenshot-to-file", [abs, "video"]);
  } catch (e) {
    console.warn("Bookmarks: screenshot failed: " + e);
    return;
  }
  state.pendingThumbs[id] = { tmp: tmp, url: state.url };
  setTimeout(() => sendRawThumb(id, 0), 200);
}

function sendRawThumb(id, attempt) {
  const pending = state.pendingThumbs[id];
  if (!pending || !state.sidebarReady) return; // retried when the sidebar becomes ready
  if (!file.exists(pending.tmp)) {
    if (attempt < 10) setTimeout(() => sendRawThumb(id, attempt + 1), 300);
    else delete state.pendingThumbs[id];
    return;
  }
  let bytes = null;
  try {
    const h = file.handle(pending.tmp, "read");
    bytes = h.readToEnd();
    h.close();
  } catch (e) {
    console.warn("Bookmarks: cannot read screenshot: " + e);
  }
  if (!bytes || !bytes.length) {
    if (attempt < 10) setTimeout(() => sendRawThumb(id, attempt + 1), 300);
    return;
  }
  post("thumb-raw", { id: id, src: "data:image/jpeg;base64," + util.bytesToBase64(bytes) });
}

function saveThumb(id, dataUrl) {
  const pending = state.pendingThumbs[id];
  delete state.pendingThumbs[id];
  if (typeof dataUrl !== "string" || dataUrl.indexOf("data:image/") !== 0) return;
  const url = pending ? pending.url : state.url;
  let exists = false;
  const list = store.update(url, null, (bms) =>
    bms.map((b) => {
      if (b.id !== id) return b;
      exists = true;
      return Object.assign({}, b, { hasThumb: true });
    })
  );
  if (pending) {
    try {
      file.delete(pending.tmp);
    } catch (e) {}
  }
  if (!exists) return; // bookmark was deleted meanwhile
  store.writeThumb(id, dataUrl);
  if (url === state.url) state.bookmarks = list;
  post("thumbs", { map: { [id]: dataUrl } });
  pushState();
}

function sendThumbs(ids) {
  const map = {};
  (ids || []).forEach((id) => {
    map[id] = store.readThumb(id);
  });
  post("thumbs", { map: map });
}

// ---------------------------------------------------------------------------
// UI sync

function pushState() {
  if (!state.sidebarReady) return;
  const files = store.allEntries().map((e) => ({
    url: e.url,
    name: e.name || util.fileNameFromUrl(e.url),
    duration: e.duration || 0,
    updatedAt: e.updatedAt || 0,
    bookmarks: e.bookmarks,
  }));
  post("state", {
    current: hasFile()
      ? {
          url: state.url,
          name: mediaMeta().name,
          duration: core.status.duration || 0,
          position: position(),
          bookmarks: state.bookmarks,
        }
      : null,
    files: files,
    thumbsEnabled: !!pref("captureThumbnails", true),
  });
}

function rebuildMenu() {
  const enabled = hasFile();
  const item = (title, action, key, opts) => {
    const o = Object.assign({ enabled: enabled }, opts || {});
    const binding = pref(key, DEFAULT_KEYS[key]);
    if (binding && binding !== "none") o.keyBinding = binding;
    return menu.item(title, action, o);
  };

  menu.removeAllItems();
  menu.addItem(item("Add Bookmark", () => addBookmark(""), "keyAdd"));
  menu.addItem(item("Add Bookmark with Title…", addNamedBookmark, "keyAddNamed"));
  menu.addItem(item("Delete Bookmark at Current Position", deleteAtPosition, "keyDelete", { enabled: state.bookmarks.length > 0 }));
  menu.addItem(menu.separator());
  menu.addItem(item("Previous Bookmark", goPrevious, "keyPrev", { enabled: state.bookmarks.length > 0 }));
  menu.addItem(item("Next Bookmark", goNext, "keyNext", { enabled: state.bookmarks.length > 0 }));

  const jump = menu.item("Jump to Bookmark", null, { enabled: state.bookmarks.length > 0 });
  state.bookmarks.forEach((b) => {
    jump.addSubMenuItem(menu.item(util.formatTime(b.time) + "   " + label(b), () => jumpTo(b)));
  });
  menu.addItem(jump);
  menu.addItem(menu.separator());
  menu.addItem(item("Show Bookmarks Manager", openManager, "keyManager", { enabled: true }));
  menu.forceUpdate();
}

function refresh() {
  applyChapters();
  rebuildMenu();
  pushState();
}

// ---------------------------------------------------------------------------
// Sidebar wiring. sidebar.loadFile() requires a loaded window and clears all
// onMessage listeners, so handlers are registered right after it.

function setupSidebar() {
  state.sidebarReady = false;
  sidebar.loadFile("ui/sidebar.html");

  sidebar.onMessage("ready", () => {
    state.sidebarReady = true;
    state.lastPostedPosition = null;
    pushState();
    Object.keys(state.pendingThumbs).forEach((id) => sendRawThumb(id, 0));
  });
  sidebar.onMessage("add", () => addBookmark(""));
  sidebar.onMessage("seek", (d) => d && typeof d.time === "number" && hasFile() && core.seekTo(d.time));
  sidebar.onMessage("jump", (d) => {
    const b = d && state.bookmarks.find((x) => x.id === d.id);
    if (b) jumpTo(b);
  });
  sidebar.onMessage("open", (d) => d && d.url && openFileAt(d.url, d.time || 0));
  sidebar.onMessage("update", (d) => d && d.id && updateBookmark(d.url, d.id, d));
  sidebar.onMessage("delete", (d) => d && d.id && deleteBookmark(d.url, d.id));
  sidebar.onMessage("clear", (d) => clearFile(d && d.url));
  sidebar.onMessage("prev", goPrevious);
  sidebar.onMessage("next", goNext);
  sidebar.onMessage("get-thumbs", (d) => sendThumbs(d && d.ids));
  sidebar.onMessage("thumb-save", (d) => d && d.id && saveThumb(d.id, d.data));
  sidebar.onMessage("thumb-failed", (d) => {
    if (d && d.id) delete state.pendingThumbs[d.id];
  });
}

// ---------------------------------------------------------------------------
// Events

event.on("iina.window-loaded", setupSidebar);

event.on("iina.file-loaded", (url) => {
  state.url = core.status.url || url || null;
  state.bookmarks = state.url ? store.getBookmarks(state.url) : [];
  state.lastJumpId = null;
  state.chaptersTouched = false;

  let chapters = [];
  try {
    chapters = mpv.getNative("chapter-list") || [];
  } catch (e) {}
  state.originalChapters = chapters.filter((c) => !util.isBookmarkChapter(c));

  refresh();

  const ps = state.pendingSeek;
  state.pendingSeek = null;
  if (ps && (ps.url === state.url || util.fileNameFromUrl(ps.url) === util.fileNameFromUrl(state.url))) {
    setTimeout(() => core.seekTo(ps.time), 300);
  }
});

event.on("mpv.end-file", () => {
  state.url = null;
  state.bookmarks = [];
  rebuildMenu();
  pushState();
});

// Keep the sidebar's "now playing" highlight in sync (cheap: only posts on change).
setInterval(() => {
  if (!state.sidebarReady || !hasFile()) return;
  const pos = Math.floor(position());
  if (pos === state.lastPostedPosition) return;
  state.lastPostedPosition = pos;
  post("position", { position: position() });
}, 1000);

rebuildMenu();
