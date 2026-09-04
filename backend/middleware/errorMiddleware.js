// Centralized error handling middleware
const config = require('../config/app.config');

// 404 Not Found middleware
function notFoundHandler(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

// Global error handler
function globalErrorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  const response = {
    success: false,
    error: {
      message: err.message || 'An unexpected error occurred.',
      // Only include stack trace in development
      stack: config.nodeEnv === 'development' ? err.stack : undefined,
    },
  };

  res.status(statusCode).json(response);
}

module.exports = {
  notFoundHandler,
  globalErrorHandler,
};

