// Extraction API routes (mounted at /api/v1/extract)
const express = require('express');
const { handleExtract } = require('../controllers/extractionController');
const { extractRateLimiter } = require('../middleware/rateLimitMiddleware');
const config = require('../config/app.config');

const router = express.Router();

// This endpoint accepts a raw R2 object key and returns that file's
// extracted text with no ownership check, so any caller who knows or
// guesses a key could read another user's uploaded document. It isn't
// used by the bundled frontend (upload results already include the
// extraction preview), so it stays disabled unless a developer opts in
// via ENABLE_EXTRACTION_PREVIEW for local debugging.
const requireExtractionPreviewEnabled = (req, res, next) => {
  if (!config.enableExtractionPreview) {
    return res.status(404).json({
      success: false,
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  }
  next();
};

// POST /api/v1/extract - Extract text from stored R2 file (dev/debug only)
router.post('/', requireExtractionPreviewEnabled, extractRateLimiter, handleExtract);

module.exports = router;

