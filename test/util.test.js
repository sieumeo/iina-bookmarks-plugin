const test = require("node:test");
const assert = require("node:assert");
const util = require("../lib/util.js");

const bms = [
  { id: "c", time: 300 },
  { id: "a", time: 10 },
  { id: "b", time: 120 },
];

test("formatTime", () => {
  assert.strictEqual(util.formatTime(0), "0:00");
  assert.strictEqual(util.formatTime(65.9), "1:05");
  assert.strictEqual(util.formatTime(3723), "1:02:03");
  assert.strictEqual(util.formatTime(null), "0:00");
});

test("findNext skips the bookmark under the playhead", () => {
  assert.strictEqual(util.findNext(bms, 0).id, "a");
  assert.strictEqual(util.findNext(bms, 10.2).id, "b");
  assert.strictEqual(util.findNext(bms, 300), null);
});

test("findPrevious behaves like a 'previous track' button", () => {
  assert.strictEqual(util.findPrevious(bms, 130).id, "b");
  assert.strictEqual(util.findPrevious(bms, 120.5).id, "a");
  assert.strictEqual(util.findPrevious(bms, 5), null);
});

test("findNearest respects tolerance", () => {
  assert.strictEqual(util.findNearest(bms, 118, 3).id, "b");
  assert.strictEqual(util.findNearest(bms, 200, 3), null);
  assert.strictEqual(util.findNearest([], 1, 3), null);
});

test("findCurrent", () => {
  assert.strictEqual(util.findCurrent(bms, 5), null);
  assert.strictEqual(util.findCurrent(bms, 150).id, "b");
});

test("buildChapterList with no bookmarks returns originals untouched", () => {
  const orig = [{ title: "Intro", time: 0 }, { title: "Part 2", time: 50 }];
  assert.deepStrictEqual(util.buildChapterList(orig, [], 100), orig);
  assert.deepStrictEqual(util.buildChapterList([], [], 100), []);
});

test("buildChapterList merges, sorts and guarantees a chapter at 0", () => {
  const list = util.buildChapterList([], [{ time: 30, title: "Kick" }, { time: 10, title: "" }], 100);
  assert.deepStrictEqual(list.map((c) => c.time), [0, 10, 30]);
  assert.ok(util.isBookmarkChapter(list[1]));
  assert.strictEqual(list[2].title, util.MARKER_PREFIX + "Kick");
  assert.strictEqual(list[1].title, util.MARKER_PREFIX + "0:10");

  const withOrig = util.buildChapterList([{ title: "Ch 1", time: 5 }], [{ time: 20, title: "x" }], 100);
  assert.deepStrictEqual(withOrig.map((c) => c.title), ["Start", "Ch 1", util.MARKER_PREFIX + "x"]);
});

test("buildChapterList drops bookmarks past the end", () => {
  const list = util.buildChapterList([], [{ time: 150, title: "late" }], 100);
  assert.deepStrictEqual(list, []);
});

test("bytesToBase64 matches Node's encoder", () => {
  for (const len of [0, 1, 2, 3, 4, 5, 1000, 20001]) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 255;
    assert.strictEqual(util.bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
  }
});

test("fileNameFromUrl", () => {
  assert.strictEqual(util.fileNameFromUrl("file:///Users/me/My%20Movie.mkv"), "My Movie.mkv");
  assert.strictEqual(util.fileNameFromUrl("https://x.com/a/b.mp4?t=1"), "b.mp4");
});
