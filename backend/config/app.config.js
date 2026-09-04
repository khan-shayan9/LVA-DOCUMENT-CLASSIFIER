// Application configuration
const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  enableExtractionPreview: String(process.env.ENABLE_EXTRACTION_PREVIEW || 'false').toLowerCase() === 'true',

  // Comma-separated list of origins allowed to call the API cross-origin.
  // The bundled frontend is served from the same origin, so this is only
  // needed if an external site must call the API directly. Unset = no
  // cross-origin access.
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
    : false,

  // Cloudflare R2 object storage
  r2: {
    accountId:       process.env.R2_ACCOUNT_ID,
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName:      process.env.R2_BUCKET_NAME,
    endpoint:        process.env.R2_ENDPOINT,
  },

  // Zilliz / Milvus vector database
  milvus: {
    address: process.env.MILVUS_ADDRESS,
    token:   process.env.MILVUS_TOKEN,
  },

  // Cloudflare Workers AI
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken:  process.env.CLOUDFLARE_API_TOKEN,
  },

  // Embedding configuration
  embeddings: {
    useContextEmbedding: String(process.env.USE_CONTEXT_EMBEDDING || 'false').toLowerCase() === 'true',
  },
};

module.exports = config;

