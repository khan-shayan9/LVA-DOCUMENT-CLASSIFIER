// Upload API routes (mounted at /api/v1/upload)
const express = require('express');
const multer = require('multer');

const uploadMiddleware = require('../middleware/uploadMiddleware');
const { uploadRateLimiter } = require('../middleware/rateLimitMiddleware');
const { handleUpload } = require('../controllers/uploadController');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/v1/upload - Upload, extract, and classify document
router.post('/', uploadRateLimiter, (req, res, next) => {
  uploadMiddleware(req, res, (err) => {
    // Intercept Multer-specific errors
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        logger.warn('Upload rejected: file size exceeds the 2 MB limit.');
        return res.status(400).json({
          success: false,
          message: 'File is too large. Maximum allowed size is 2 MB.',
        });
      }

      logger.error('Multer error during upload.', err);
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`,
      });
    }

    if (err) {
      logger.error('Unknown error during upload middleware.', err);
      return next(err);
    }

    // Forward to controller
    handleUpload(req, res, next);
  });
});

module.exports = router;
