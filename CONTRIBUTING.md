# Contributing

Contributions are welcome. Please open an issue before starting significant work so we can discuss the approach.

## Development setup

```bash
git clone https://github.com/tripodsan/pdf-stitcher.git
cd pdf-stitcher
npm install
npm run dev
```

## Workflow

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Run `npm run typecheck` — must pass with no errors.
4. Run `npm run build` — must complete successfully.
5. Open a pull request against `main`.

## Code style

- Vue 3 Composition API with `<script setup>` throughout.
- All processing must remain client-side — no network requests, no server.
- Keep the core stitching logic in `src/lib/stitcher.ts`; the only place that imports `pdf-lib`.
- New components go in `src/components/`.

## Reporting bugs

Open a GitHub issue with a description of the problem and, if possible, a sample PDF that triggers it (or a description of the PDF's properties — page count, rotation, encryption, layers).
