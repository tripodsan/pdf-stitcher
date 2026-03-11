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
| `src/lib/stitcher.ts` | Core PDF imposition logic + `logPageBoxes` helper. The only place that imports `pdf-lib`. |
| `src/types.ts` | `StitchSettings` and `PageBox` types shared between UI and lib. |
| `src/components/StitchSettings.vue` | Settings form (grid, page box, overlap, page range, blank slots). |
| `src/components/PdfViewer.vue` | PDF viewer with pan/zoom; accepts `label`, `subtitle`, `oversample`, `preserveView` props. |
| `src/App.vue` | File drop/upload, orchestrates processing, download. |

### How stitching works

`stitchPdf(fileBytes, settings)` in `src/lib/stitcher.ts`:

1. Loads source PDF with `PDFDocument.load`
2. Slices pages to the requested range
3. Builds a tile sequence, inserting `null` (blank) at the user-specified 1-based slot positions; source pages fill the rest in order
4. Reads tile dimensions from the selected `PageBox` (trim/media/crop/bleed/art) of the first page in range
5. Calculates output page dimensions: `cols × (tileW − overlapX) + overlapX` wide, same pattern vertically
6. Embeds all needed source pages once with `newDoc.embedPdf(srcDoc, indices)`
7. Groups tiles into sheets of `cols × rows`, creates one output page per sheet, draws each tile at `(col × strideX − box.x, (rows−1−row) × strideY − box.y)` — subtracting the box origin handles non-zero TrimBox offsets; PDF coordinates are bottom-left origin
8. Returns `StitchResult { bytes, widthPt, heightPt }` — caller converts pts → mm for display

Overlap/margin inputs are in **mm** and converted to PDF points (`mm × 72 / 25.4`) inside the stitcher.

`logPageBoxes(fileBytes)` logs all five box dimensions for every page to the browser console when a file is loaded.

## Deployment

Deployed to `https://pdf.atelier-feldegg.ch` via GitHub Pages. Push to `main` triggers the deploy workflow. Vite `base` is `/`. The `public/CNAME` file sets the custom domain on every deploy.

### Planned future feature

Content removal (strip page marks, borders drawn inside content streams) will require **mupdf.js** (WASM). The plan is to lazy-load it alongside pdf-lib — pdf-lib handles stitching, mupdf handles content editing. They can coexist.
