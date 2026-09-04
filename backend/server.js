// Express application entry point
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const config = require('./config/app.config');
const indexRouter = require('./routes/index');
const uploadRouter = require('./routes/uploadRoutes');
const extractionRouter = require('./routes/extractionRoutes');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorMiddleware');

const app = express();

// Global middleware
// corsOrigin is false unless CORS_ORIGIN is set, which blocks cross-origin
// browser requests by default (the frontend is served same-origin anyway).
app.use(cors({ origin: config.corsOrigin }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// API Routes
app.use('/', indexRouter);
app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/extract', extractionRouter);

// Error handlers
app.use(notFoundHandler);
app.use(globalErrorHandler);

// Start server
app.listen(config.port, function () {
  console.log('============================================================');
  console.log('  AI-Based Document Classification System');
  console.log('============================================================');
  console.log(`  Environment : ${config.nodeEnv}`);
  console.log(`  Server URL  : http://localhost:${config.port}`);
  console.log('  Status      : Running ✓');
  console.log('============================================================');
});

module.exports = app;

