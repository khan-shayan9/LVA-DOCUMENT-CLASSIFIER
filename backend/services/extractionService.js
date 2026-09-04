// Document text extraction service for PDF, DOCX, and XLSX files
const path = require('path');
const { pathToFileURL } = require('url');
const logger = require('../utils/logger');
const ocrService = require('./ocrService');
const { getFromR2 } = require('./r2Service');

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

// Lazy-load PDF.js fallback
const loadPdfJs = () => {
  const pdfJsPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  return import(pathToFileURL(pdfJsPath).href);
};

// Detect document type from a filename or R2 object key extension
const detectFileType = (nameOrKey) => {
  const ext = path.extname(nameOrKey).toLowerCase();
  const typeMap = {
    '.pdf': 'pdf',
    '.docx': 'docx',
    '.xlsx': 'xlsx',
    '.xls': 'xls',
  };
  return typeMap[ext] || 'unsupported';
};

// Extract plain text from PDF buffer using pdf-parse
const extractPdf = async (buffer) => {
  const result = await pdfParse(buffer);
  return result.text || '';
};

// Fallback PDF extraction using PDF.js for malformed PDFs
const extractPdfWithPdfJs = async (buffer) => {
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdfDocument = await loadingTask.promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();

    let lastY;
    let pageText = '';

    for (const item of textContent.items) {
      if (!item.str) continue;

      if (lastY === undefined || lastY === item.transform[5]) {
        pageText += item.str;
      } else {
        pageText += '\n' + item.str;
      }

      lastY = item.transform[5];
    }

    pageText = pageText.trim();
    if (pageText.length > 0) {
      pageTexts.push(pageText);
    }
  }

  return pageTexts.join('\n\n');
};

// Check if error warrants PDF.js fallback
const shouldUsePdfJsFallback = (err) => {
  const message = (err && err.message ? err.message : '').toLowerCase();
  return (
    message.includes('bad xref entry') ||
    message.includes('xref') ||
    message.includes('invalid pdf') ||
    message.includes('trailer')
  );
};

// Check if OCR fallback should be attempted
const shouldUseOcrFallback = (text, err) => {
  if (typeof text === 'string' && text.trim().length > 0) {
    return false;
  }

  if (!err) return true;

  const message = (err.message || '').toLowerCase();
  return (
    message.includes('bad xref entry') ||
    message.includes('xref') ||
    message.includes('invalid pdf') ||
    message.includes('trailer') ||
    message.includes('empty') ||
    message.includes('parse')
  );
};

// Extract plain text from DOCX buffer using mammoth
const extractDocx = async (buffer) => {
  const result = await mammoth.extractRawText({ buffer: buffer });
  return result.value || '';
};

// Extract text from XLSX/XLS workbook sheets
const extractExcel = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheetTexts = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_csv(sheet);
    return `[Sheet: ${sheetName}]\n${rows}`;
  });

  return sheetTexts.join('\n\n');
};

// Run format-specific extraction (+ OCR fallback) on an in-memory buffer.
// Shared by both the R2-backed and direct-buffer entry points below.
const extractFromBuffer = async (buffer, fileType, label) => {
  if (!buffer || buffer.length === 0) {
    throw new Error(`File "${label}" is empty.`);
  }

  let text;
  let pdfParseError = null;

  if (fileType === 'pdf') {
    try {
      text = await extractPdf(buffer);
    } catch (err) {
      pdfParseError = err;
      if (shouldUsePdfJsFallback(err)) {
        logger.warn(`pdf-parse failed for "${label}" (${err.message}). Retrying with PDF.js fallback.`);
        text = await extractPdfWithPdfJs(buffer);
      } else {
        throw err;
      }
    }
  } else if (fileType === 'docx') {
    text = await extractDocx(buffer);
  } else if (fileType === 'xlsx' || fileType === 'xls') {
    text = extractExcel(buffer);
  }

  // Attempt OCR fallback if PDF text extraction yielded no content
  if (fileType === 'pdf' && shouldUseOcrFallback(text, pdfParseError)) {
    try {
      logger.warn(`Text extraction returned no usable text for "${label}". Trying OCR fallback.`);
      const ocrText = await ocrService.extractTextWithOcr(buffer);
      if (ocrText && ocrText.trim().length > 0) {
        text = ocrText;
      }
    } catch (ocrErr) {
      logger.warn(`OCR fallback failed for "${label}": ${ocrErr.message}`);
    }
  }

  if (text.length === 0) {
    logger.warn(`Extraction produced no text for "${label}". The document may be empty or image-only.`);
  } else {
    logger.success(`Extraction complete: "${label}" — ${text.length} chars.\n\n`);
  }

  return {
    fileType: fileType,
    text: text || '',
  };
};

// Retrieve file from R2 and extract text based on file format.
// Used by the (debug-only, opt-in) POST /api/v1/extract endpoint.
const retrieveAndExtract = async (r2Key) => {
  const fileType = detectFileType(r2Key);
  if (fileType === 'unsupported') {
    throw new Error(`Unsupported file type for key: "${r2Key}". Supported types: PDF, DOCX, XLSX, XLS.`);
  }

  logger.info(`Extracting "${r2Key}" (${fileType})`);

  const buffer = await getFromR2(r2Key);
  return extractFromBuffer(buffer, fileType, r2Key);
};

// Extract text directly from an already-in-memory upload buffer, skipping
// the R2 round trip. Used by the main upload pipeline, where the buffer is
// already available from Multer.
const extractUploadedFile = async (buffer, originalname) => {
  const fileType = detectFileType(originalname);
  if (fileType === 'unsupported') {
    throw new Error(`Unsupported file type for "${originalname}". Supported types: PDF, DOCX, XLSX, XLS.`);
  }

  logger.info(`Extracting "${originalname}" (${fileType})`);

  return extractFromBuffer(buffer, fileType, originalname);
};

module.exports = {
  retrieveAndExtract,
  extractUploadedFile,
};

