const test = require("node:test");
const assert = require("node:assert");
const { createStore } = require("../lib/store.js");

// In-memory stand-in for iina.file.
function fakeFile() {
  const files = {};
  return {
    files,
    exists: (p) => p in files,
    read: (p) => files[p],
    write: (p, c) => { files[p] = c; },
    delete: (p) => { delete files[p]; },
  };
}
const quiet = { error() {}, warn() {}, log() {} };

test("add, update and remove bookmarks per file", () => {
  const f = fakeFile();
  const store = createStore(f, quiet);
  const url = "file:///a.mp4";

  store.update(url, { name: "a.mp4", duration: 100 }, (l) => l.concat([{ id: "2", time: 50 }, { id: "1", time: 5 }]));
  assert.deepStrictEqual(store.getBookmarks(url).map((b) => b.id), ["1", "2"]);
  assert.strictEqual(store.getEntry(url).name, "a.mp4");

  store.update(url, null, (l) => l.filter((b) => b.id !== "1"));
  assert.deepStrictEqual(store.getBookmarks(url).map((b) => b.id), ["2"]);

  store.update(url, null, () => []);
  assert.strictEqual(store.getEntry(url), null);
  assert.deepStrictEqual(store.allEntries(), []);
});

test("two windows writing different files don't clobber each other", () => {
  const f = fakeFile();
  const w1 = createStore(f, quiet);
  const w2 = createStore(f, quiet);
  w1.update("u1", null, (l) => l.concat([{ id: "x", time: 1 }]));
  w2.update("u2", null, (l) => l.concat([{ id: "y", time: 2 }]));
  assert.strictEqual(w1.allEntries().length, 2);
});

test("a corrupt database is backed up instead of overwritten silently", () => {
  const f = fakeFile();
  f.files["@data/bookmarks.json"] = "{not json";
  const store = createStore(f, quiet);
  assert.deepStrictEqual(store.getBookmarks("u"), []);
  assert.ok(Object.keys(f.files).some((k) => k.indexOf("bookmarks.broken-") >= 0));
});

test("thumbnails", () => {
  const f = fakeFile();
  const store = createStore(f, quiet);
  assert.strictEqual(store.readThumb("id1"), null);
  store.writeThumb("id1", "data:image/jpeg;base64,AAA");
  assert.strictEqual(store.readThumb("id1"), "data:image/jpeg;base64,AAA");
  store.deleteThumb("id1");
  assert.strictEqual(store.readThumb("id1"), null);
});
