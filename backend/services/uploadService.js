// Upload business logic service
const { uploadToR2 } = require('./r2Service');
const logger = require('../utils/logger');

// Upload file to Cloudflare R2 and construct document metadata
const processUpload = async (file) => {
  const r2Result = await uploadToR2(file.buffer, file.originalname, file.mimetype);

  logger.success(`R2 upload complete: "${r2Result.key}" (${file.size} bytes)`);

  return {
    r2Key:        r2Result.key,
    r2Bucket:     r2Result.bucket,
    originalName: file.originalname,
    mimeType:     file.mimetype,
    size:         file.size,
    uploadedAt:   new Date().toISOString(),
  };
};

module.exports = {
  processUpload,
};

