// Vector embedding generation service via Cloudflare Workers AI (@cf/baai/bge-base-en-v1.5)
const config = require('../config/app.config');
const logger = require('../utils/logger');

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EXPECTED_DIMENSION = 768;
const CF_AI_URL = (accountId, model) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

// Validate required environment variables
if (!config.cloudflare.accountId) {
  throw new Error('[embeddingService] CLOUDFLARE_ACCOUNT_ID is not set in the .env file.');
}

if (!config.cloudflare.apiToken) {
  throw new Error('[embeddingService] CLOUDFLARE_API_TOKEN is not set in the .env file.');
}

// Prepend GS-17 classification framing context to document text
const addClassificationContext = (cleanedText) => {
  const context = `
You are analyzing a government/organizational document for records retention classification.

This document should be classified according to the Library of Virginia Records Retention and Disposition Schedule (GS-17).

GS-17 contains records series for government agencies covering:
- Personnel and administrative records (employee files, attendance, payroll)
- Law enforcement records (investigations, case files, incident reports)
- Financial and property records (assessments, restitution, compensation)
- Vehicle and equipment records (maintenance, inspection, inventory)
- Victim services and compensation records
- Court and legal process records
- And other government operational records

Determine which GS-17 series this document belongs to by analyzing its content, purpose, and scope.

DOCUMENT CONTENT:
"""
${cleanedText}
"""

Analyze this document carefully.
  `.trim();

  return context;
};

// Request 768-dim float vector from Cloudflare Workers AI
const generateVector = async (inputText) => {
  const url = CF_AI_URL(config.cloudflare.accountId, EMBEDDING_MODEL);
  logger.info(`Requesting embedding from Workers AI (model: ${EMBEDDING_MODEL})...`);

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${config.cloudflare.apiToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ text: inputText }),
    });
  } catch (networkErr) {
    throw new Error(`[embeddingService] Network error contacting Cloudflare Workers AI: ${networkErr.message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(unreadable)');
    throw new Error(`[embeddingService] Cloudflare Workers AI returned HTTP ${response.status}. Body: ${errorBody}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (parseErr) {
    throw new Error(`[embeddingService] Could not parse JSON response from Workers AI: ${parseErr.message}`);
  }

  // Parse vector from Workers AI response formats
  let vector = null;
  if (json.result) {
    if (Array.isArray(json.result.data) && json.result.data.length > 0 && Array.isArray(json.result.data[0])) {
      vector = json.result.data[0];
    } else if (Array.isArray(json.result) && typeof json.result[0] === 'number') {
      vector = json.result;
    }
  }

  if (!vector || !Array.isArray(vector)) {
    throw new Error('[embeddingService] Unexpected response shape from Workers AI. Expected array of floats.');
  }

  if (vector.length !== EXPECTED_DIMENSION) {
    throw new Error(`[embeddingService] Dimension mismatch: expected ${EXPECTED_DIMENSION}, but received ${vector.length}.`);
  }

  logger.success(`Embedding generated successfully. Dimension: ${vector.length}`);
  return vector;
};

const { createDocumentContextWindow } = require('./textCleaningService');

const MAX_EMBEDDING_CHARS = 1500;

// Generate 768-dimensional vector embedding for text
const generateEmbedding = async (text, options = {}) => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('[embeddingService] generateEmbedding() requires a non-empty string.');
  }

  const windowedText = createDocumentContextWindow(text, {
    maxLength: MAX_EMBEDDING_CHARS,
    headRatio: 0.4,
    middleRatio: 0.2,
    tailRatio: 0.4,
  });

  const useContext = typeof options.useContext === 'boolean'
    ? options.useContext
    : config.embeddings.useContextEmbedding;

  const embeddingInput = useContext ? addClassificationContext(windowedText) : windowedText;
  return generateVector(embeddingInput);
};

// Helper for generating embedding with context explicitly enabled
const generateContextualEmbedding = async (cleanedText) => {
  return generateEmbedding(cleanedText, { useContext: true });
};

module.exports = {
  generateEmbedding,
  addClassificationContext,
  generateContextualEmbedding,
};

