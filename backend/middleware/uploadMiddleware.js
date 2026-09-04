// Multer memory storage and file validation middleware
const multer = require('multer');
const UPLOAD_CONSTANTS = require('../config/constants');
const logger = require('../utils/logger');

// Store file in memory buffer for Cloudflare R2 upload
const storage = multer.memoryStorage();

// Validate file MIME type
const fileFilter = (req, file, callback) => {
  const isAllowed = UPLOAD_CONSTANTS.ALLOWED_MIME_TYPES.includes(file.mimetype);

  if (!isAllowed) {
    req.fileValidationError = `Invalid file type. Only ${UPLOAD_CONSTANTS.ALLOWED_EXTENSIONS.join(', ')} files are accepted.`;
    logger.warn(`Rejected file: "${file.originalname}" (type: ${file.mimetype})`);
    return callback(null, false);
  }

  callback(null, true);
};

// Multer upload configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: UPLOAD_CONSTANTS.MAX_FILE_SIZE,
  },
});

// Single file upload handler for 'document' field
module.exports = upload.single('document');

