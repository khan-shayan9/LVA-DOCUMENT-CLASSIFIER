// Upload constants and validation limits
const UPLOAD_CONSTANTS = {
  // Maximum allowed file size: 2 MB
  MAX_FILE_SIZE: 2 * 1024 * 1024,

  // Allowed MIME types for uploaded files
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],

  // Allowed file extensions for display/validation
  ALLOWED_EXTENSIONS: ['.pdf', '.docx', '.xlsx', '.xls'],

  // Local uploads folder
  UPLOADS_FOLDER: 'uploads',
};

// Rate limiting — protects paid downstream APIs (R2, Milvus, Cloudflare AI)
// from being drained by scripted or excessive requests.
const RATE_LIMIT_CONSTANTS = {
  WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  UPLOAD_MAX_REQUESTS: 20,   // full upload -> extract -> classify pipeline
  EXTRACT_MAX_REQUESTS: 30,  // extraction only
};

module.exports = UPLOAD_CONSTANTS;
module.exports.RATE_LIMIT_CONSTANTS = RATE_LIMIT_CONSTANTS;

