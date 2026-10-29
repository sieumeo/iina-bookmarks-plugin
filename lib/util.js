// Pure helpers with no dependency on the IINA API, so they can be unit-tested in Node.

// Seconds -> "H:MM:SS" (or "M:SS" when under an hour).
function formatTime(seconds) {
  if (typeof seconds !== "number" || !isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sortByTime(bookmarks) {
  return bookmarks.slice().sort((a, b) => a.time - b.time);
}

// Bookmark after the current position. `gap` avoids "jumping" to the bookmark we are standing on.
function findNext(bookmarks, position, gap) {
  if (gap === undefined) gap = 0.5;
  const sorted = sortByTime(bookmarks);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].time > position + gap) return sorted[i];
  }
  return null;
}

// Bookmark before the current position. Like a music player's "previous" button:
// if we are only a moment past a bookmark, go to the one before it.
function findPrevious(bookmarks, position, gap) {
  if (gap === undefined) gap = 1.5;
  const sorted = sortByTime(bookmarks);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].time < position - gap) return sorted[i];
  }
  return null;
}

// Closest bookmark within `tolerance` seconds, or null.
function findNearest(bookmarks, position, tolerance) {
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < bookmarks.length; i++) {
    const d = Math.abs(bookmarks[i].time - position);
    if (d < bestDist) {
      best = bookmarks[i];
      bestDist = d;
    }
  }
  return best && bestDist <= tolerance ? best : null;
}

// The bookmark the playhead is currently "in" (last one at or before position).
function findCurrent(bookmarks, position) {
  const sorted = sortByTime(bookmarks);
  let current = null;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].time <= position + 0.25) current = sorted[i];
    else break;
  }
  return current;
}

const MARKER_PREFIX = "\u{1F516} "; // bookmark emoji, shown in IINA's chapter list

// Build the mpv `chapter-list` value: original chapters plus one chapter per bookmark.
// IINA's slider skips the first chapter when drawing ticks (it assumes it starts at 0),
// so a chapter at 0 is guaranteed to exist whenever bookmarks are present.
function buildChapterList(originalChapters, bookmarks, duration) {
  const originals = (originalChapters || []).map((c) => ({ title: c.title || "", time: c.time }));
  if (!bookmarks || bookmarks.length === 0) return originals;

  const marks = bookmarks
    .filter((b) => b.time >= 0 && (!duration || b.time < duration))
    .map((b) => ({ title: MARKER_PREFIX + (b.title || formatTime(b.time)), time: b.time }));

  const list = originals.concat(marks).sort((a, b) => a.time - b.time);
  if (list.length > 0 && list[0].time > 0.001) {
    list.unshift({ title: originals.length > 0 ? "Start" : "", time: 0 });
  }
  return list;
}

function isBookmarkChapter(chapter) {
  return !!chapter && typeof chapter.title === "string" && chapter.title.indexOf(MARKER_PREFIX) === 0;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// JavaScriptCore in IINA's plugin context has no btoa(), so encode bytes manually.
function bytesToBase64(bytes) {
  const out = [];
  const len = bytes.length;
  let chunk = "";
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    chunk +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < len ? B64[(n >> 6) & 63] : "=") +
      (i + 2 < len ? B64[n & 63] : "=");
    if (chunk.length >= 8192) {
      out.push(chunk);
      chunk = "";
    }
  }
  out.push(chunk);
  return out.join("");
}

// Display name for a media URL: last path component, URL-decoded.
function fileNameFromUrl(url) {
  if (!url) return "";
  let s = String(url).split("?")[0].replace(/\/+$/, "");
  s = s.substring(s.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

module.exports = {
  formatTime,
  makeId,
  sortByTime,
  findNext,
  findPrevious,
  findNearest,
  findCurrent,
  buildChapterList,
  isBookmarkChapter,
  bytesToBase64,
  fileNameFromUrl,
  MARKER_PREFIX,
};
