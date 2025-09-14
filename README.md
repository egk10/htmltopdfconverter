# HTML to PDF Uploader

![CI](https://github.com/egk10/htmltopdfconverter/actions/workflows/ci.yml/badge.svg)

Simple Node.js service + dual-mode frontend (upload or inline editor) to convert HTML to PDF using headless Chromium (Puppeteer). PDFs are streamed to the browser and stored in `generated/` with a unique suffix.

## Features
- Upload `.html` file and receive PDF download
- Inline editor: edit / paste HTML, live iframe preview, export directly
- Persistent storage: `generated/<basename>-<id>.pdf`
- Letter page size, prints backgrounds, configurable max pages scaling
- Heuristic iterative scaling to limit output pages (default 2) without huge white gaps
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
- Scaling is heuristic: content is uniformly scaled down (CSS transform) until total height fits inside `maxPages * printableHeight` or a minimum readable scale (~0.35) is reached.
- Extremely long documents may still exceed the page target or become small; consider real pagination for complex cases.
- Remote assets must be accessible from the server to render.
- Active JavaScript in uploaded HTML will run; disable via code hardening if needed.
- Letter format only (changeable in code). A4 or custom size would need adaptation (and height constant recalibration).
- Scaling uses an approximate printable height of 1056px (Letter minus margins at 96 DPI). Adjust if you change margins or DPI context.
- White space gaps can still occur if original markup imposes page breaks (large block elements, explicit CSS page-breaks, etc.).
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
- `TWO_PAGE_FIT` (default enabled): set to `false` to disable scaling.
- `MAX_PAGES` (default `2`): default max pages target when not provided by client.

## Scaling Algorithm Overview
1. Load HTML into headless Chromium.
2. Measure `document.documentElement.scrollHeight`.
3. If height > limit (`printablePerPage * maxPages`), apply scale = limit / height via body transform.
4. Re-measure up to 5–6 passes with short waits to allow layout stabilization.
5. Abort if computed scale would drop below ~0.35.

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
