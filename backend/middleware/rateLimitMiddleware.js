// Request rate limiting for cost-sensitive / abuse-prone endpoints
const rateLimit = require('express-rate-limit');
const { RATE_LIMIT_CONSTANTS } = require('../config/constants');

// Consistent JSON error shape for throttled requests
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
  });
};

// Guards POST /api/v1/upload (file storage + embeddings + LLM classification)
const uploadRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONSTANTS.WINDOW_MS,
  max: RATE_LIMIT_CONSTANTS.UPLOAD_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Guards POST /api/v1/extract (R2 fetch + text extraction)
const extractRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONSTANTS.WINDOW_MS,
  max: RATE_LIMIT_CONSTANTS.EXTRACT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

module.exports = {
  uploadRateLimiter,
  extractRateLimiter,
};
