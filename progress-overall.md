# Project Progress Report — PDF Stitcher

## Overview

A browser-only PDF imposition tool built from scratch over two sessions (2026-03-11 and 2026-03-12). No backend — all processing runs client-side via pdf-lib and pdfjs-dist. Deployed to https://pdf.atelier-feldegg.ch via GitHub Pages.

---

## Session 1 — 2026-03-11

### Bootstrapped from scratch

Starting point: empty repo (`f0a8572 initial`).

### Features shipped

| Commit | Feature |
|--------|---------|
| `6b5b57b` | Vue 3 + Vite + TypeScript scaffold; pdf-lib stitching core; pdfjs source + result viewers with pan/zoom |
| `492fc2c` | Preserve zoom/pan on result re-stitch |
| `1dfaff6` | GitHub Pages deployment workflow |
| `ddf4ce4` | Remove rows setting — derive row count from tile count |
| `be61b4b` | Auto-set columns to `sqrt(pages)` on document load |
| `052942a` | Show result dimensions (mm) in viewer subtitle and download filename |
| `11e34d6` | Page box selector (Trim / Media / Crop / Bleed / Art) + `logPageBoxes` console helper |
| `b153d23` | Custom domain: `pdf.atelier-feldegg.ch` |
| `d5da388` | Fix: swap tile dimensions for rotated pages (Rotate 90°/270°) |
| `2f9ae59` | Fix: apply page `/Rotate` transform when drawing embedded tiles |
| `80c963c` | OCG layer support (show/hide layers in output) + encrypted PDF handling via mupdf.js WASM |
| `4c4cc24` | Fix: prevent double render on initial OCG layer load |
| `795d0ee` | Fix: hide layer list when only one layer present |

### Architecture at end of session 1

- **3-column layout**: source PdfViewer | controls | result PdfViewer
- Settings: grid columns, page box, overlap (X/Y mm), page range, blank slot positions (text field)
- `blankSlots: number[]` — user specifies 1-based positions where blanks are inserted; source pages fill the rest
- Encrypted PDFs: pdf-lib triggers decrypt via mupdf.js WASM, then retries

---

## Session 2 — 2026-03-12

### Features shipped

| Commit | Feature |
|--------|---------|
| `835db47` | Visual drag-and-drop tile grid; 2-column layout with tabbed right panel |
| `32a67c2` | CLAUDE.md architecture docs updated |

### What changed

Replaced the indirect blank-slot text field with an Acrobat-style visual tile grid:

- **TileGrid component** — pdfjs renders 2× resolution thumbnails into a CSS grid that tracks the columns setting. Tiles can be dragged to reorder; a `+` button (hover, top-left) inserts a blank before any tile; `×` (hover, top-right) removes a tile; Reset restores natural order.
- **Layout**: 3-column → 2-column (`400px` controls + `1fr` right panel). Right panel has two tabs: **Tile Order** (always visible) and **Result** (auto-activates after stitching).
- **Data model**: `blankSlots: number[]` → `tileSequence: (number | null)[]` — explicit ordered sequence; stitcher reads it directly.
- **Source viewer removed** — thumbnails in the tile grid make it redundant.

### Bugs found and fixed during session 2

1. **Chicken-and-egg load deadlock** — TileGrid watched `[sourceBytes, pageRange]` together; returned early when `pageRange` was null so `loaded` was never emitted so `pageRange` was never set. Split into two watches.
2. **`const reactive` v-model silent failure** — `settings = $event` fails on a const; switched to `Object.assign(settings, $event)`.
3. **Flex layout not forming a proper grid** — removed interleaved insert-col flex elements; replaced with `display: grid; grid-template-columns: repeat(columns, 1fr)`.

---

## Total stats

| Metric | Value |
|--------|-------|
| Sessions | 2 |
| Total commits | 22 |
| Files changed (all time) | 63 |
| Lines added | ~3 900 |
| Lines removed | ~230 |
| Net lines | ~3 670 |

### Time estimates

| Session | Wall time | Active agent time | Feedback cycles |
|---------|-----------|-------------------|-----------------|
| 2026-03-11 | ~3–4 h | ~25–35 min | ~15 |
| 2026-03-12 | ~45–60 min | ~8–12 min | 6 |
| **Total** | **~4–5 h** | **~35–45 min** | **~21** |

### Token estimates

| Session | Input | Output | Total |
|---------|-------|--------|-------|
| 2026-03-11 | ~60 000 | ~30 000 | ~90 000 |
| 2026-03-12 | ~35 000 | ~18 000 | ~53 000 |
| **Total** | **~95 000** | **~48 000** | **~143 000** |

Session 1 was token-heavier due to bootstrapping from scratch (scaffolding, multiple new files, many short iteration cycles on rotation/layer bugs). Session 2 was dominated by the large TileGrid component and App.vue rewrite, with cheaper targeted fixes after.
