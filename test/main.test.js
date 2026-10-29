// Runs main.js against a mocked `iina` global to exercise the full flow.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const files = {};
  const events = {};
  const sidebarHandlers = {};
  const posted = [];
  const osds = [];
  const mpvSets = [];
  const mpvCommands = [];
  const menuItems = [];
  const timers = [];
  const status = { idle: false, position: 0, duration: 600, paused: false, url: "file:///v/movie.mkv", title: "movie.mkv", videoWidth: 1920 };
  const prefs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "Info.json"), "utf8")).preferenceDefaults;
  let prompted = "Climax";
  let seekedTo = null;

  const mkItem = (title, action, opts) => ({ title, action, opts: opts || {}, sub: [], addSubMenuItem(i) { this.sub.push(i); return this; } });

  const iina = {
    core: {
      status,
      window: { loaded: true },
      osd: (m) => osds.push(m),
      pause() {}, resume() {},
      seekTo: (t) => { seekedTo = t; status.position = t; },
      open: (u) => { status.url = u; },
      getChapters: () => [],
    },
    mpv: {
      set: (k, v) => mpvSets.push([k, v]),
      command: (n, a) => {
        mpvCommands.push([n, a]);
        if (n === "screenshot-to-file") files["@tmp/" + path.basename(a[0])] = new Uint8Array([255, 216, 255, 1, 2, 3]);
      },
      getNative: () => [{ title: "Opening", time: 0 }, { title: "Act 2", time: 200 }],
    },
    event: { on: (n, cb) => { (events[n] = events[n] || []).push(cb); return n; } },
    menu: {
      item: mkItem,
      separator: () => mkItem("-"),
      addItem: (i) => menuItems.push(i),
      removeAllItems: () => { menuItems.length = 0; },
      forceUpdate() {},
    },
    sidebar: {
      loadFile() { Object.keys(sidebarHandlers).forEach((k) => delete sidebarHandlers[k]); },
      onMessage: (n, cb) => { sidebarHandlers[n] = cb; },
      postMessage: (n, d) => posted.push([n, JSON.parse(decodeURIComponent(d.d))]),
      show() {},
    },
    preferences: { get: (k) => prefs[k] },
    utils: { prompt: () => prompted, ask: () => true, resolvePath: (p) => "/abs/" + p.replace("@", "") },
    file: {
      exists: (p) => p in files,
      read: (p) => files[p],
      write: (p, c) => { files[p] = c; },
      delete: (p) => { delete files[p]; },
      handle: (p) => ({ readToEnd: () => files[p], close() {} }),
    },
    console: { log() {}, warn() {}, error() {} },
  };

  const modules = {};
  const req = (p) => {
    const full = path.join(__dirname, "..", p);
    if (!modules[full]) {
      const mod = { exports: {} };
      vm.runInContext("(function(module, exports, require){" + fs.readFileSync(full, "utf8") + "\n})", ctx)(mod, mod.exports, req);
      modules[full] = mod.exports;
    }
    return modules[full];
  };
  const ctx = vm.createContext({
    iina,
    setTimeout: (fn) => { timers.push(fn); return String(timers.length); },
    setInterval: () => "i",
    clearTimeout() {}, clearInterval() {},
    encodeURIComponent, decodeURIComponent, JSON, Math, Date, Object, String,
  });
  ctx.require = req;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8"), ctx);

  const emit = (n, arg) => (events[n] || []).forEach((cb) => cb(arg));
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  const lastState = () => posted.filter((p) => p[0] === "state").pop()[1];
  const menuByTitle = (t) => menuItems.find((i) => i.title.indexOf(t) === 0);

  return { files, status, emit, sidebarHandlers, posted, osds, mpvSets, mpvCommands, menuItems, flushTimers, lastState, menuByTitle,
           get seekedTo() { return seekedTo; }, setPrompt: (v) => { prompted = v; } };
}

test("end-to-end: add, navigate, timeline, thumbnails, delete", () => {
  const t = setup();
  t.emit("iina.window-loaded");
  t.sidebarHandlers.ready({});
  t.emit("iina.file-loaded", t.status.url);

  assert.strictEqual(t.menuByTitle("Add Bookmark").opts.keyBinding, "Meta+b");
  assert.strictEqual(t.mpvSets.length, 0, "no chapter writes before there are bookmarks");

  t.status.position = 42.3;
  t.menuByTitle("Add Bookmark").action();
  t.status.position = 42.5;
  t.menuByTitle("Add Bookmark").action(); // duplicate, rejected
  assert.match(t.osds.pop(), /already exists/);

  t.status.position = 400;
  t.menuByTitle("Add Bookmark with Title").action();

  const st = t.lastState();
  assert.deepStrictEqual(st.current.bookmarks.map((b) => [b.time, b.title]), [[42.3, ""], [400, "Climax"]]);
  assert.strictEqual(st.files.length, 1);

  // Timeline: originals kept, bookmarks merged.
  const [key, chapters] = t.mpvSets[t.mpvSets.length - 1];
  assert.strictEqual(key, "chapter-list");
  assert.deepStrictEqual(chapters.map((c) => c.time), [0, 42.3, 200, 400]);

  // Navigation.
  t.status.position = 100;
  t.menuByTitle("Previous Bookmark").action();
  assert.strictEqual(t.seekedTo, 42.3);
  t.menuByTitle("Next Bookmark").action();
  assert.strictEqual(t.seekedTo, 400);
  t.menuByTitle("Next Bookmark").action();
  assert.match(t.osds.pop(), /No next bookmark/);
  assert.strictEqual(t.menuByTitle("Jump to Bookmark").sub.length, 2);

  // Thumbnail pipeline: screenshot -> raw to sidebar -> small version saved.
  assert.strictEqual(t.mpvCommands.filter((c) => c[0] === "screenshot-to-file").length, 2);
  t.flushTimers();
  const raws = t.posted.filter((p) => p[0] === "thumb-raw");
  assert.strictEqual(raws.length, 2);
  assert.ok(raws[0][1].src.indexOf("data:image/jpeg;base64,/9j/") === 0);
  t.sidebarHandlers["thumb-save"]({ id: raws[0][1].id, data: "data:image/jpeg;base64,SMALL" });
  assert.ok(t.lastState().current.bookmarks.find((b) => b.id === raws[0][1].id).hasThumb);
  assert.ok(!Object.keys(t.files).some((k) => k === "@tmp/shot-" + raws[0][1].id + ".jpg"), "tmp screenshot removed");
  t.sidebarHandlers["get-thumbs"]({ ids: [raws[0][1].id] });
  const thumbs = t.posted.filter((p) => p[0] === "thumbs").pop()[1];
  assert.strictEqual(thumbs.map[raws[0][1].id], "data:image/jpeg;base64,SMALL");

  // Edit from the sidebar; a backtick must survive the message encoding.
  const id400 = t.lastState().current.bookmarks[1].id;
  t.sidebarHandlers.update({ id: id400, title: "The `end` ${x}", note: "n" });
  assert.strictEqual(t.lastState().current.bookmarks[1].title, "The `end` ${x}");

  // Hotkey delete near the playhead.
  t.status.position = 401;
  t.menuByTitle("Delete Bookmark").action();
  assert.deepStrictEqual(t.lastState().current.bookmarks.map((b) => b.time), [42.3]);

  // Clear all restores the original chapters.
  t.sidebarHandlers.clear({});
  assert.deepStrictEqual(t.mpvSets[t.mpvSets.length - 1][1].map((c) => c.title), ["Opening", "Act 2"]);
  assert.strictEqual(t.lastState().files.length, 0);
});

test("bookmarks persist across reopening the file", () => {
  const t = setup();
  t.emit("iina.window-loaded");
  t.sidebarHandlers.ready({});
  t.emit("iina.file-loaded");
  t.status.position = 12;
  t.menuByTitle("Add Bookmark").action();

  t.emit("mpv.end-file");
  assert.strictEqual(t.lastState().current, null);
  t.emit("iina.file-loaded");
  assert.deepStrictEqual(t.lastState().current.bookmarks.map((b) => b.time), [12]);
});

test("opening a bookmark from another file seeks after load", () => {
  const t = setup();
  t.emit("iina.window-loaded");
  t.sidebarHandlers.ready({});
  t.emit("iina.file-loaded");
  t.sidebarHandlers.open({ url: "file:///v/other.mkv", time: 77 });
  assert.strictEqual(t.status.url, "file:///v/other.mkv");
  t.emit("iina.file-loaded");
  t.flushTimers();
  assert.strictEqual(t.seekedTo, 77);
});
