# Project conventions

- Keep all product UI copy in `public/copy.mjs`; avoid user-facing strings in HTML and rendering code.
- Keep fee solvers pure and independent of the WebSocket client and UI.
- Preserve strict lower-fee priority comparison, deterministic lower-fee ties, the 0.01 sat/vB grid, and the atomic fee tier crossing the 95% search boundary.
- Publish only the static asset allowlist from `scripts/assets.mjs` into `dist/`.
- Run `npm run verify` and `npm run deploy:check` for changes affecting application behavior or deployment packaging.
