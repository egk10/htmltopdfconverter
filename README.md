# HTML to PDF Uploader

![CI](https://github.com/egk10/htmltopdfconverter/actions/workflows/ci.yml/badge.svg)

Simple Node.js service + dual-mode frontend (upload or inline editor) to convert HTML to PDF using headless Chromium (Puppeteer). PDFs are streamed to the browser and stored in `generated/` with a unique suffix.

## Features
- Upload `.html` file and receive PDF download
- Inline editor: edit / paste HTML, live iframe preview, export directly
- Persistent storage: `generated/<basename>-<id>.pdf`
- Letter page size, prints backgrounds, configurable max pages scaling
- Optional compression mode (typography tightening + column layout + zoom) to better fit target pages
- Metadata headers (`X-Meta-*`) expose scaling/compression decisions
- API endpoint `/convert-text` for programmatic or editor use
- Port auto-fallback if 3000 busy; health endpoint `/health`

## Install (Local)
```bash
npm install
```

## Run (Local)
```bash
npm start
# Visit http://localhost:3000
```

(Dev mode with auto-reload if you modify server code):
```bash
npm run dev
```

## Usage (Upload Mode)
1. Open the web page.
2. Choose a `.html` file (inline CSS & remote assets allowed if reachable).
3. (Optional) Adjust Max Pages field (default 2).
4. Click "Convert to PDF".
5. PDF downloads; copy stored in `generated/`.

## Usage (Editor Mode)
1. Click "Editor Mode".
2. Paste or write HTML in the textarea.
3. Click "Update Preview" to refresh iframe.
4. Adjust Max Pages (scaling target) if desired.
5. Click "Download PDF" to export.

## Programmatic Example (`/convert-text`)
```bash
curl -X POST http://localhost:3000/convert-text \
	-H 'Content-Type: application/json' \
	-d '{"html":"<h1>Hello</h1><p>World</p>","name":"example","maxPages":2}' --output example.pdf
```

## Notes & Limitations
- Two-phase approach now used:
	1) Optional compression (if `compress=true` form field or body param): injects reduced spacing + multi-column hints + font/line-height tweaks.
	2) Zoom-based reflow scaling (CSS `zoom`) attempts to fit within `maxPages` height budget.
- If content remains taller than budget at a conservative minimum readable zoom (~0.25–0.3), PDF is produced “best effort” and headers indicate fit failure (`X-Meta-fit:false`).
- Very long / verbose documents: consider manual pruning or true pagination logic (future enhancement) rather than aggressive shrinking.
- Remote assets must be accessible from the server to render.
- Active JavaScript in uploaded HTML will run; disable via code hardening if needed.
- Letter format only. Changing format requires adjusting usable height assumption (980px per page currently after margins).
- White space can persist if source HTML has large structural blocks or explicit page breaks; editing original markup (removing unnecessary padding/margins) often yields better results than pure scaling.
- Generated PDFs are not stored in git (ignored); only a `.gitkeep` placeholder remains.

## Docker
Build image:
```bash
docker build -t htmltopdf:latest .
```
Run container:
```bash
docker run --rm -p 3000:3000 \
	-e MAX_PAGES=2 \
	-e TWO_PAGE_FIT=true \
	-v $(pwd)/generated:/app/generated \
	htmltopdf:latest
```
Then open http://localhost:3000

Provide custom Chromium path (if using base image with different binary):
```bash
docker run --rm -p 3000:3000 \
	-e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
	htmltopdf:latest
```

## Environment Variables
- `PORT` (default `3000`): server listen port.
- `TWO_PAGE_FIT` (default enabled): set to `false` to disable scaling/zoom.
- `MAX_PAGES` (default `2`): default max pages target when not provided by client.
- `PUPPETEER_EXECUTABLE_PATH` / `CHROMIUM_PATH`: override browser binary.

## Scaling & Compression Overview
1. (Optional) Compression stage if client specifies `compress=true`:
	- Injects tighter CSS: reduced body padding / margins, smaller vertical rhythm, potential multi-column hints.
2. Initial measurement: `scrollHeight` captured.
3. If over height budget (`usableHeightPerPage (≈980px) * maxPages`), compute candidate zoom.
4. Apply zoom and re-measure; refine once if still over.
5. Generate PDF; store metadata describing outcome.

### Requesting Compression
- Upload form: include field `compress=true`.
- `/convert-text` JSON: `{ "html": "...", "compress": true }`.

### Response Headers (when available)
- `X-Meta-scale`: Final applied zoom factor (1 = none).
- `X-Meta-compressed`: `true` if compression stylesheet injected.
- `X-Meta-initial-height`: Height before zoom (px).
- `X-Meta-final-height`: Height after zoom (px).
- `X-Meta-limit`: Height budget (px) = `maxPages * 980`.
- `X-Meta-page-estimate`: Estimated page count after scaling.
- `X-Meta-fit`: `true/false` if final height within budget.

### Improving Fit Without Over-Shrinking
- Remove unnecessary manual page breaks.
- Reduce large top/bottom padding in the original HTML.
- Consolidate repeated section headings.
- Use lists or multi-column layout for dense bullet spans.
- Shorten verbose bullet text (content editing often beats heavier scaling).

## Future Enhancements (Ideas)
- True pagination (splitting content across pages without shrinking)
- Optional header/footer templates
- Support asset bundles (ZIP) for relative image/CSS references
- JS disabling toggle per request
- Download history listing endpoint

## Hardening Ideas (Not implemented by default)
- Scan / sanitize incoming HTML (DOMPurify server-side) before rendering.
- Enforce stricter Content Security Policy.
- Run Chromium with seccomp / user namespace isolation in a container.
- Add rate limiting & auth if exposed publicly.

## License
MIT License (see `LICENSE`).
