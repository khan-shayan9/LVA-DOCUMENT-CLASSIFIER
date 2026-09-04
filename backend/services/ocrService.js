// Persistent Tesseract OCR worker pool for scanned PDFs
const path = require('path');
const { pathToFileURL } = require('url');
const { createCanvas } = require('@napi-rs/canvas');
const { createWorker } = require('tesseract.js');
const logger = require('../utils/logger');

const POOL_SIZE = 3;
const MIN_TEXT_LENGTH = 10;
const RENDER_SCALE = 2.0;

const pool = [];
const waitQueue = [];

// Acquire an available worker slot from pool
const acquireSlot = () => {
  const freeSlot = pool.find((slot) => slot.available);
  if (freeSlot) {
    freeSlot.available = false;
    return Promise.resolve(freeSlot);
  }

  return new Promise((resolve) => {
    waitQueue.push(resolve);
  });
};

// Return a slot to the pool or pass directly to waiting caller
const releaseSlot = (slot) => {
  if (waitQueue.length > 0) {
    const nextResolve = waitQueue.shift();
    nextResolve(slot);
  } else {
    slot.available = true;
  }
};

// Initialize persistent Tesseract workers
const initializePool = async () => {
  logger.info(`OCR: initializing worker pool (${POOL_SIZE} workers)…`);
  const initPromises = [];

  for (let i = 0; i < POOL_SIZE; i += 1) {
    const initOne = createWorker('eng', 1, { logger: () => {} }).then((worker) => {
      pool.push({
        id: i,
        worker,
        canvas: createCanvas(1, 1),
        available: true,
      });
    });
    initPromises.push(initOne);
  }

  await Promise.all(initPromises);
  logger.info(`OCR: worker pool ready — ${POOL_SIZE} workers available.`);
};

const poolReady = initializePool();

// Lazy-load PDF.js
const loadPdfJs = () => {
  const pdfJsPath = path.join(
    __dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'
  );
  return import(pathToFileURL(pdfJsPath).href);
};

// Extract embedded text layer from a PDF page
const getEmbeddedPageText = async (page) => {
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => item.str || '')
    .join(' ')
    .trim();
};

const hasUsableText = (text) => text.length >= MIN_TEXT_LENGTH;

// Render PDF page to PNG buffer via canvas
const renderPageToBuffer = async (page, slot) => {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  slot.canvas.width  = Math.ceil(viewport.width);
  slot.canvas.height = Math.ceil(viewport.height);

  const context = slot.canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;

  return slot.canvas.toBuffer('image/png');
};

// Run OCR on a single rendered page
const runOcrOnPage = async (page) => {
  const slot = await acquireSlot();
  try {
    const imageBuffer = await renderPageToBuffer(page, slot);
    const result = await slot.worker.recognize(imageBuffer);
    return (result.data.text || '').trim();
  } finally {
    releaseSlot(slot);
  }
};

// Extract text from PDF using selective OCR on pages without embedded text
const extractTextWithOcr = async (buffer) => {
  await poolReady;

  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdfDocument = await loadingTask.promise;
  const totalPages  = pdfDocument.numPages;
  const pageResults = new Array(totalPages).fill('');

  logger.info(`OCR: starting selective OCR on ${totalPages} page(s) (batch size: ${POOL_SIZE}).`);

  // Process pages in parallel batches
  for (let batchStart = 1; batchStart <= totalPages; batchStart += POOL_SIZE) {
    const batchEnd = Math.min(batchStart + POOL_SIZE - 1, totalPages);
    const batchPromises = [];

    for (let pageNumber = batchStart; pageNumber <= batchEnd; pageNumber += 1) {
      const currentPage = pageNumber;

      const pagePromise = (async () => {
        const page = await pdfDocument.getPage(currentPage);
        const embeddedText = await getEmbeddedPageText(page);

        if (hasUsableText(embeddedText)) {
          logger.info(`OCR: page ${currentPage}/${totalPages} — embedded text found, skipping OCR.`);
          return { pageNumber: currentPage, text: embeddedText };
        }

        logger.info(`OCR: page ${currentPage}/${totalPages} — no embedded text, running OCR.`);
        const ocrText = await runOcrOnPage(page);
        return { pageNumber: currentPage, text: ocrText };
      })();

      batchPromises.push(pagePromise);
    }

    const batchResults = await Promise.all(batchPromises);
    for (const { pageNumber, text } of batchResults) {
      pageResults[pageNumber - 1] = text;
    }
  }

  return pageResults.filter((t) => t.length > 0).join('\n\n');
};

module.exports = {
  extractTextWithOcr,
};

