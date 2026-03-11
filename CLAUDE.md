# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start Vite dev server
npm run build      # type-check + production build
npm run preview    # preview production build
npm run typecheck  # type-check only (no emit)
```

## Architecture

Browser-only PDF stitching tool (no backend). Everything runs client-side; files never leave the browser.

**Stack:** Vue 3 (Composition API + `<script setup>`) · TypeScript · Vite · pdf-lib

### Key files

| File | Purpose |
|------|---------|
| `src/lib/stitcher.ts` | Core PDF imposition logic. The only place that imports `pdf-lib`. |
| `src/types.ts` | `StitchSettings` interface shared between UI and lib. |
| `src/components/StitchSettings.vue` | Settings form (grid, overlap, page range, blank slots). |
| `src/App.vue` | File drop/upload, orchestrates processing, download. |

### How stitching works

`stitchPdf(fileBytes, settings)` in `src/lib/stitcher.ts`:

1. Loads source PDF with `PDFDocument.load`
2. Slices pages to the requested range
3. Builds a tile sequence, inserting `null` (blank) at the user-specified 1-based slot positions; source pages fill the rest in order
4. Calculates output page dimensions: `cols × (tileW − overlapX) + overlapX` wide, same pattern vertically
5. Embeds all needed source pages once with `newDoc.embedPdf(srcDoc, indices)`
6. Groups tiles into sheets of `cols × rows`, creates one output page per sheet, draws each tile at `(col × strideX, (rows−1−row) × strideY)` — PDF coordinates are bottom-left origin
7. Returns `Uint8Array` from `newDoc.save()`

Overlap/margin inputs are in **mm** and converted to PDF points (`mm × 72 / 25.4`) inside the stitcher.

### Planned future feature

Content removal (strip page marks, borders drawn inside content streams) will require **mupdf.js** (WASM). The plan is to lazy-load it alongside pdf-lib — pdf-lib handles stitching, mupdf handles content editing. They can coexist.
