// Root and health check routes
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

const router = express.Router();

// GET / - Serve upload UI with injected client config
router.get('/', function (req, res, next) {
  try {
    const filePath = path.join(__dirname, '..', 'views', 'index.html');
    const html = fs.readFileSync(filePath, 'utf8').replace(
      '__APP_CONFIG__',
      JSON.stringify({
        enableExtractionPreview: config.enableExtractionPreview,
      })
    );

    res.type('html').send(html);
  } catch (err) {
    next(err);
  }
});

// GET /api/health - API health check endpoint
router.get('/api/health', function (req, res) {
  res.status(200).json({
    success: true,
    project: 'AI-Based Document Classification System',
    status: 'Running',
  });
});

module.exports = router;

