import express from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs/promises';
import puppeteer from 'puppeteer';
import os from 'os';

const DEFAULT_MAX_PAGES = parseInt(process.env.MAX_PAGES || '2', 10);

const OUTPUT_DIR = path.resolve('generated');
await fs.mkdir(OUTPUT_DIR, { recursive: true });

const app = express();
const preferredPort = parseInt(process.env.PORT || '3000', 10);
let serverInstance;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (!/\.html?$/i.test(file.originalname)) {
      return cb(new Error('Only .html files are allowed'));
    }
    cb(null, true);
  }
});

app.use(express.static(path.resolve('public')));

async function createPdfFromHtmlString(htmlContent, baseName, maxPages = DEFAULT_MAX_PAGES, options = {}) {
  const { compress = false } = options;
  const jobId = nanoid(8);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html2pdf-'));
  const htmlPath = path.join(tmpDir, `upload-${jobId}.html`);
  await fs.writeFile(htmlPath, htmlContent, 'utf8');
  const execPath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  const launchOptions = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (execPath) launchOptions.executablePath = execPath;
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });
    // Optional compression stylesheet (typography tightening + multi-column) before measuring
    if (compress) {
      await page.addStyleTag({ content: `body,html{margin:0;padding:0;} body{font-size:90%; line-height:1.15;} h1,h2,h3,h4{margin:0.35em 0 0.25em;} p,li{margin:0.25em 0;} ul,ol{padding-left:1.1em; margin:0.4em 0;} section{margin:0.5em 0;} .columns, body > main, body > div:first-of-type{column-count:2; column-gap:1.2em;} table{font-size:90%;}` });
    }
    // Zoom-based reflow scaling: adjust zoom (reflows layout) so content height fits into maxPages.
    let computedScale = 1;
    const enableFit = process.env.TWO_PAGE_FIT !== 'false';
    let metaRecord = null;
    if (enableFit) {
      const usablePerPage = 980; // approximate usable height in px after margins at 96dpi
      const limit = usablePerPage * maxPages;
      const metrics = await page.evaluate(() => ({ initialHeight: document.documentElement.scrollHeight }));
      if (metrics.initialHeight > limit) {
        const targetScale = Math.max(0.25, Math.min(1, limit / metrics.initialHeight));
        computedScale = targetScale;
  await page.addStyleTag({ content: `html{ zoom:${computedScale}; }` });
  await new Promise(r => setTimeout(r, 60));
        // Fine tune if still slightly over (single refinement pass)
        const after = await page.evaluate(() => document.documentElement.scrollHeight);
        if (after > limit && computedScale > 0.3) {
          const refined = Math.max(0.25, computedScale * (limit / after) * 0.98);
            if (refined < computedScale) {
              computedScale = refined;
              await page.addStyleTag({ content: `html{ zoom:${computedScale}; }` });
              await new Promise(r => setTimeout(r, 40));
            }
        }
        const finalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        const pageEstimate = finalHeight / usablePerPage;
        const fit = finalHeight <= limit;
        metaRecord = { scale: computedScale, compressed: compress, initialHeight: metrics.initialHeight, finalHeight, limit, pageEstimate: +pageEstimate.toFixed(2), fit };
      } else {
        metaRecord = { scale: 1, compressed: compress, initialHeight: metrics.initialHeight, finalHeight: metrics.initialHeight, limit, pageEstimate: +(metrics.initialHeight / usablePerPage).toFixed(2), fit: true };
      }
    }
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
    });
    const storedPath = path.join(OUTPUT_DIR, `${baseName}-${jobId}.pdf`);
    await fs.writeFile(storedPath, pdfBuffer);
    if (!metaRecord) {
      const finalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      metaRecord = { scale: computedScale, compressed: compress, initialHeight: finalHeight, finalHeight, limit: maxPages * 980, pageEstimate: +(finalHeight / 980).toFixed(2), fit: finalHeight <= (maxPages * 980) };
    }
    return { pdfBuffer, storedPath, jobId, meta: metaRecord };
  } finally {
    await browser.close();
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

app.post('/convert', upload.single('htmlFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const htmlContent = req.file.buffer.toString('utf8');
    const baseName = path.basename(req.file.originalname).replace(/\.[^.]+$/, '');
    const maxPages = parseInt(req.body.maxPages || DEFAULT_MAX_PAGES, 10);
    const compress = (req.body.compress || '').toString().toLowerCase() === 'true';
    const { pdfBuffer, storedPath, meta } = await createPdfFromHtmlString(htmlContent, baseName, maxPages, { compress });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    res.setHeader('X-Stored-File', path.basename(storedPath));
    if (meta) {
      Object.entries(meta).forEach(([k,v]) => {
        res.setHeader('X-Meta-' + k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()), String(v));
      });
    }
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to convert HTML to PDF', detail: err.message });
  }
});

app.post('/convert-text', express.json({ limit: '1mb' }), async (req, res) => {
  const { html, name = 'document', maxPages } = req.body || {};
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Missing html field (string)' });
  }
  try {
    const mp = parseInt(maxPages || DEFAULT_MAX_PAGES, 10);
    const compress = !!req.query.compress || (req.body.compress === true) || (req.body.compress === 'true');
    const { pdfBuffer, storedPath, meta } = await createPdfFromHtmlString(html, name, mp, { compress });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    res.setHeader('X-Stored-File', path.basename(storedPath));
    if (meta) {
      Object.entries(meta).forEach(([k,v]) => {
        res.setHeader('X-Meta-' + k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()), String(v));
      });
    }
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to convert HTML to PDF', detail: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function start(port) {
  serverInstance = app.listen(port, () => {
    const actual = serverInstance.address().port;
    console.log(`HTML to PDF service listening on http://localhost:${actual}`);
  });
  serverInstance.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port === preferredPort) {
      const fallback = 0; // 0 lets OS assign an available port
      console.warn(`Port ${port} in use. Retrying with an ephemeral port...`);
      start(fallback);
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

start(preferredPort);
