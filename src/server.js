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

async function createPdfFromHtmlString(htmlContent, baseName, maxPages = DEFAULT_MAX_PAGES) {
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
    // Multi-pass scaling: adjust until content fits within maxPages or scale becomes too small
    const enableFit = process.env.TWO_PAGE_FIT !== 'false';
    if (enableFit) {
      await page.addStyleTag({ content: 'html,body{margin:0;padding:0;}' });
      const printablePerPage = 1056; // approx letter usable height
      for (let attempt = 0; attempt < 6; attempt++) {
        const result = await page.evaluate(({ printablePerPage, maxPages }) => {
          const styleId = 'multi-page-fit-style';
          const totalHeight = document.documentElement.scrollHeight;
          const limit = printablePerPage * maxPages;
          let action = 'none';
          if (totalHeight > limit) {
            const scale = limit / totalHeight;
            let st = document.getElementById(styleId);
            if (!st) { st = document.createElement('style'); st.id = styleId; document.head.appendChild(st); }
            st.textContent = `body{transform-origin: top left; transform: scale(${scale}); width:${(100/scale)}%;}`;
            action = 'scaled';
          }
          return { totalHeight, limit, action, scaleApplied: (limit / totalHeight) };
        }, { printablePerPage, maxPages });
        if (result.totalHeight <= result.limit) break;
        if (result.scaleApplied < 0.35) break; // stop before unreadable
        await page.waitForTimeout(60);
      }
    }
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
    });
    const storedPath = path.join(OUTPUT_DIR, `${baseName}-${jobId}.pdf`);
    await fs.writeFile(storedPath, pdfBuffer);
    return { pdfBuffer, storedPath, jobId };
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
    const { pdfBuffer, storedPath } = await createPdfFromHtmlString(htmlContent, baseName, maxPages);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    res.setHeader('X-Stored-File', path.basename(storedPath));
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
    const { pdfBuffer, storedPath } = await createPdfFromHtmlString(html, name, mp);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    res.setHeader('X-Stored-File', path.basename(storedPath));
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
