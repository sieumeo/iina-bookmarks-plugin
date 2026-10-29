# IINA Bookmarks

A bookmark manager plugin for [IINA](https://iina.io) (1.4+). It has hotkeys to add, delete and jump between bookmarks, a sidebar manager with thumbnails, and bookmark markers on the progress bar.

## Features

| Feature | How |
| --- | --- |
| Add bookmark | `⌘B` (quick) or `⇧⌘B` (asks for a title) |
| Delete bookmark | `⌘⌫` deletes the bookmark you just jumped to or the nearest one within 3 s |
| Previous / next bookmark | `⌥⌘←` / `⌥⌘→` |
| Bookmarks manager | `⌥⌘B` opens the **Bookmarks** sidebar tab |
| Jump menu | Plugin › Jump to Bookmark lists every bookmark of the current file |
| Timeline markers | Bookmarks are drawn as ticks on the progress bar |

You can change every shortcut in Settings › Plugins › Bookmarks › Preferences. They use mpv key names, e.g. `Meta+b`; set one to `none` to disable it.

### Manager (sidebar)

- List view and thumbnail grid view.
- **This file** shows the current video. **All files** shows every bookmarked file; clicking one opens that file at the bookmark.
- Click to jump. Double-click or use the pencil icon to edit the title, note or time.
- Search by title, note or timestamp.
- Clear all bookmarks of a file.

### Thumbnails

When you add a bookmark, the plugin captures the current frame (video only, without subtitles) with mpv's `screenshot-to-file`. The sidebar shrinks it to 320 px and it is stored in the plugin's data folder. Bookmarks added from an audio file have no thumbnail.

### Timeline markers: one setting to enable

IINA's plugin API has no way to draw on the progress bar. The plugin works around this by merging bookmarks into the file's chapter list, which IINA can draw as ticks. To see them:

1. Open IINA Settings › UI and enable **Show chapter positions in progress bar** (it is off by default).
2. Keep **Show bookmarks on the progress bar** enabled in the plugin preferences (on by default).

Side effects: bookmarks also appear in the Chapters panel with a 🔖 prefix, and mpv's chapter navigation will stop at them. The file's real chapters are kept, and nothing is written to the video file. Turn the preference off if you don't want this.

## Install

**From GitHub (auto-updates):** IINA Settings › Plugins › Install from GitHub… › `sieumeo/iina-bookmarks-plugin`

**For development:**

```bash
git clone https://github.com/sieumeo/iina-bookmarks-plugin.git
```

```bash
ln -s "$PWD/iina-bookmarks-plugin" ~/Library/Application\ Support/com.colliderli.iina/plugins/iina-bookmarks.iinaplugin-dev
```

Then restart IINA. Logs appear in Window › Log Viewer under `player<N> - Bookmarks`.

Permissions requested:

- `file-system`: needed by IINA for mpv's screenshot and chapter-list access.
- `show-osd`: on-screen messages.
- `show-alert`: title prompt and the "clear all" confirmation.

## Data

Everything is stored in `~/Library/Application Support/com.colliderli.iina/plugins/.data/io.github.sieumeo.iina-bookmarks/`:

- `bookmarks.json`: bookmarks grouped by media URL.
- `thumb-<id>.txt`: small JPEG thumbnails as data URLs.

Bookmarks are keyed by the file's URL, so moving or renaming a file detaches its bookmarks.

## Project layout

```
Info.json          plugin manifest
main.js            entry: hotkeys, menu, seeking, chapters, thumbnails, sidebar messaging
lib/util.js        pure helpers (navigation, chapter merge, base64), unit-tested
lib/store.js       JSON persistence in @data
ui/sidebar.html    manager UI (self-contained HTML/CSS/JS)
preferences.html   settings page
test/              Node tests (`npm test`), including a mocked-IINA run of main.js
```

No build step is needed. IINA loads the files as they are.

## License

MIT
