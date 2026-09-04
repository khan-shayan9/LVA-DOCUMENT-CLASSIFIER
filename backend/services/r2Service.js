// Cloudflare R2 object storage service (S3-compatible)
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const config = require('../config/app.config');
const logger = require('../utils/logger');

// S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

// Generate unique, sanitized object key
const generateObjectKey = (originalname) => {
  const timestamp = Date.now();
  const ext = path.extname(originalname).toLowerCase();
  const baseName = path.basename(originalname, ext);
  const safeName = baseName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${timestamp}-${safeName}${ext}`;
};

// Upload a file buffer to Cloudflare R2
const uploadToR2 = async (buffer, originalname, mimetype) => {
  const key = generateObjectKey(originalname);

  const command = new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  });

  await s3Client.send(command);

  return {
    key: key,
    bucket: config.r2.bucketName,
    size: buffer.length,
  };
};

// Download a file buffer from Cloudflare R2 by key
const getFromR2 = async (key) => {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
  });

  const response = await s3Client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);

  logger.success(`R2 fetch complete: "${key}" (${buffer.length} bytes)`);
  return buffer;
};

module.exports = {
  uploadToR2,
  getFromR2,
};

