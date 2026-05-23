# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start Vite dev server
npm run build      # type-check + production build
npm run preview    # preview production build
npm run typecheck  # type-check only (no emit)
npm run analyze-pdf <file.pdf> [maxPages]  # inspect PDF content streams (see below)
```

## Architecture

Browser-only PDF stitching tool (no backend). Everything runs client-side; files never leave the browser.

**Stack:** Vue 3 (Composition API + `<script setup>`) · TypeScript · Vite · pdf-lib · pdfjs-dist

### Key files

| File | Purpose |
|------|---------|
| `src/lib/stitcher.ts` | Core PDF imposition logic + `logPageBoxes` helper. The only place that imports `pdf-lib`. |
| `src/lib/decryptPdf.ts` | Lazy-loads mupdf WASM to decrypt encrypted PDFs; called as a fallback when pdf-lib fails to parse. |
| `src/types.ts` | `StitchSettings` and `PageBox` types shared between UI and lib. |
| `src/components/StitchSettings.vue` | Settings form (grid, page box, overlap, page range). |
| `src/components/TileGrid.vue` | Visual tile grid: page thumbnails (pdfjs), drag-to-reorder, insert blank, remove tile. |
| `src/components/PdfViewer.vue` | PDF viewer with pan/zoom; accepts `label`, `subtitle`, `oversample`, `preserveView` props. |
| `src/App.vue` | File drop/upload, orchestrates processing, download. Two-column layout: controls + tabbed right panel (Tile Order / Result). |

### Layout

Two-column workspace: `400px` controls column + `1fr` right panel. The right panel has two tabs:
- **Tile Order** — always visible when a file is loaded; shows TileGrid
- **Result** — shows the result PdfViewer; auto-activates after stitching

### Tile sequence data model

`StitchSettings.tileSequence: (number | null)[]` — ordered tile sequence where numbers are 1-based within the page range and `null` = blank tile. Empty array means natural order (computed at stitch time). TileGrid initialises it and emits updates; stitcher reads it directly.

**Reactive settings caveat:** `settings` in App.vue is a `const reactive(...)` object. StitchSettings emits a full replacement object via `update:modelValue`, so it is wired as `:model-value="settings" @update:model-value="Object.assign(settings, $event)"` — not `v-model` — to avoid the silent reassignment failure on a const reactive.

### How stitching works

`stitchPdf(fileBytes, settings)` in `src/lib/stitcher.ts`:

1. Loads source PDF with `PDFDocument.load`
2. Slices pages to the requested range
3. Uses `settings.tileSequence` directly (maps 1-based range numbers → 0-based absolute indices); falls back to natural order if empty
4. Reads tile dimensions from the selected `PageBox` (trim/media/crop/bleed/art) of the first page in range
5. Calculates output page dimensions: `cols × (tileW − overlapX) + overlapX` wide, same pattern vertically
6. Embeds all needed source pages once with `newDoc.embedPdf(srcDoc, indices)`
7. Groups tiles into sheets of `cols × rows`, creates one output page per sheet, draws each tile at `(col × strideX − box.x, (rows−1−row) × strideY − box.y)` — subtracting the box origin handles non-zero TrimBox offsets; PDF coordinates are bottom-left origin
8. Returns `StitchResult { bytes, widthPt, heightPt }` — caller converts pts → mm for display

Overlap/margin inputs are in **mm** and converted to PDF points (`mm × 72 / 25.4`) inside the stitcher.

`logPageBoxes(fileBytes)` logs all five box dimensions for every page to the browser console when a file is loaded.

## Deployment

Deployed to `https://pdf.atelier-feldegg.ch` via GitHub Pages. Push to `main` triggers the deploy workflow. Vite `base` is `/`. The `public/CNAME` file sets the custom domain on every deploy.

### mupdf integration

**mupdf** (WASM) is lazy-loaded by two modules:
- `decryptPdf.ts` — fallback decryption when pdf-lib can't parse an encrypted PDF
- `removeBorders.ts` — strips helper marks from source pages before stitching (corner registration marks, border rectangles, alignment diamonds, pagination overlays, badge circles)

`removeBorders.ts` uses a token-level content stream rewriter. It detects known mark signatures and excises their token ranges before reassembling the stream. Add new rules in `stripHelperBorders()` by identifying a unique color or structural signature and pushing a `[start, end]` range onto the `ranges` array.

### PDF stream analyzer

`scripts/analyze-pdf-streams.mjs` is a Node.js dev tool for inspecting PDF content streams to identify helper-mark signatures before writing a removal rule. Run it when a new PDF style isn't cleaned up correctly:

```bash
npm run analyze-pdf tmp/somefile.pdf [maxPages]
```

Output per page: `/OC BDC` blocks with `re` counts and color values, `/Cs*` color spaces, PAT-style `0 G re S` borders, `/Fm* Do` XObject calls, and all `rg`/`RG`/`scn`/`SCN` color values found outside BDC blocks.

**Known PDF styles handled by `removeBorders.ts`:**

| Style | Signature | What's removed |
|-------|-----------|----------------|
| PAT | `/Cs8 CS` + `0 G re S` | Corner L-marks + border rect |
| PAT | `0.87611 0 0 rg` … `h f` | Red badge circle |
| PAT | `q 0 1 -1 0 … cm` | Rotated badge text |
| BECKY | `0.925 0.125 0.153 SCN` + `re S` | Red border rectangles |
| BECKY | `0.184 0.208 0.561 scn` | Blue alignment diamonds |
| BECKY | `/Fm* Do` | Pagination overlays |
| Birkin | `/OC BDC` with `0 0 0 RG` + ≥3 `re` | Border rects + triangle marks |
