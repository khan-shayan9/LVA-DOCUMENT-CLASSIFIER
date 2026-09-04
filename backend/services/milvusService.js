// Milvus / Zilliz Cloud vector database service
const path = require('path');
const fs   = require('fs');
const { MilvusClient, DataType, MetricType } = require('@zilliz/milvus2-sdk-node');
const config = require('../config/app.config');
const logger = require('../utils/logger');
const { generateEmbedding } = require('./embeddingService');

const SCHEDULES_DIR = path.resolve(__dirname, '../data/schedules');
// Primary schedule path (used by insertRecords which is GS-17 only)
const GS17_DATASET_PATH = path.join(SCHEDULES_DIR, 'gs-17.json');

// Load and merge records from all schedule JSON files in data/schedules/
const loadAllScheduleRecords = () => {
  const files = fs.readdirSync(SCHEDULES_DIR).filter(f => f.endsWith('.json'));
  return files.flatMap(f => {
    try { return JSON.parse(fs.readFileSync(path.join(SCHEDULES_DIR, f), 'utf8')).records || []; }
    catch (e) { logger.warn(`Could not load schedule file ${f}: ${e.message}`); return []; }
  });
};

// Validate environment variables
if (!config.milvus.address) {
  throw new Error('[milvusService] MILVUS_ADDRESS is not set in the .env file.');
}

if (!config.milvus.token) {
  throw new Error('[milvusService] MILVUS_TOKEN is not set in the .env file.');
}

// Singleton MilvusClient instance
const milvusClient = new MilvusClient({
  address: config.milvus.address,
  token:   config.milvus.token,
});

logger.info('MilvusClient instance created (connection pending verification).');

// Verify connection to Zilliz Cloud cluster
const verifyConnection = async () => {
  try {
    const result = await milvusClient.getVersion();
    logger.success(`Milvus connection verified. Server version: ${result.version}`);
    return {
      connected: true,
      version:   result.version,
    };
  } catch (err) {
    logger.error('Milvus connection verification failed.', err);
    throw new Error(
      `[milvusService] Could not connect to Zilliz Cloud at "${config.milvus.address}". Original error: ${err.message}`
    );
  }
};

// Collection constants
const COLLECTION_NAME = 'gs17_records';
const EMBEDDING_DIM = 768;
const VARCHAR_MAX_LEN = 2048;

// GS-17 schema definition
const GS17_SCHEMA = [
  {
    name:           'id',
    data_type:      DataType.Int64,
    is_primary_key: true,
    autoID:         true,
    description:    'Auto-generated primary key',
  },
  {
    name:        'schedule_number',
    data_type:   DataType.VarChar,
    max_length:  64,
    description: 'e.g. GS-17',
  },
  {
    name:        'schedule_title',
    data_type:   DataType.VarChar,
    max_length:  VARCHAR_MAX_LEN,
    description: 'Human-readable schedule title',
  },
  {
    name:        'series_number',
    data_type:   DataType.VarChar,
    max_length:  64,
    description: 'Unique series identifier within the schedule',
  },
  {
    name:        'series_title',
    data_type:   DataType.VarChar,
    max_length:  VARCHAR_MAX_LEN,
    description: 'Human-readable series title',
  },
  {
    name:        'series_description',
    data_type:   DataType.VarChar,
    max_length:  VARCHAR_MAX_LEN,
    description: 'Full description of the record series',
  },
  {
    name:        'series_retention_period',
    data_type:   DataType.VarChar,
    max_length:  256,
    description: 'How long the records must be kept',
  },
  {
    name:        'series_disposition_method',
    data_type:   DataType.VarChar,
    max_length:  256,
    description: 'How records are disposed of after retention',
  },
  {
    name:        'text_to_embed',
    data_type:   DataType.VarChar,
    max_length:  VARCHAR_MAX_LEN,
    description: 'Pre-built text string that was embedded',
  },
  {
    name:        'embedding',
    data_type:   DataType.FloatVector,
    dim:         EMBEDDING_DIM,
    description: `${EMBEDDING_DIM}-dim vector from @cf/baai/bge-base-en-v1.5`,
  },
];

// Idempotent collection creation, index setup, and loading
const ensureCollection = async () => {
  const { value: exists } = await milvusClient.hasCollection({
    collection_name: COLLECTION_NAME,
  });

  let created = false;

  if (exists) {
    logger.info(`Collection "${COLLECTION_NAME}" already exists — skipping creation.`);
  } else {
    logger.info(`Creating collection "${COLLECTION_NAME}"...`);

    await milvusClient.createCollection({
      collection_name:    COLLECTION_NAME,
      fields:             GS17_SCHEMA,
      enableDynamicField: false,
      description:        'GS-17 Law Enforcement record series for semantic search',
    });

    logger.success(`Collection "${COLLECTION_NAME}" created.`);
    created = true;

    logger.info('Creating vector index on "embedding" field...');
    await milvusClient.createIndex({
      collection_name: COLLECTION_NAME,
      field_name:      'embedding',
      index_type:      'AUTOINDEX',
      metric_type:     MetricType.COSINE,
    });

    logger.success('Vector index created.');
  }

  logger.info(`Loading collection "${COLLECTION_NAME}" into memory...`);
  await milvusClient.loadCollection({
    collection_name: COLLECTION_NAME,
  });

  logger.success(`Collection "${COLLECTION_NAME}" loaded.`);

  const description = await milvusClient.describeCollection({
    collection_name: COLLECTION_NAME,
  });

  const fields = description.schema.fields;
  const embeddingField = fields.find(f => f.name === 'embedding');

  if (!embeddingField) {
    throw new Error('[milvusService] Schema verification failed: "embedding" field not found in collection.');
  }

  const isFloatVector = embeddingField.data_type === 'FloatVector';
  const actualDim     = parseInt(embeddingField.type_params.find(p => p.key === 'dim')?.value, 10);

  if (!isFloatVector) {
    throw new Error(`[milvusService] Schema verification failed: "embedding" field is "${embeddingField.data_type}", expected "FloatVector".`);
  }

  if (actualDim !== EMBEDDING_DIM) {
    throw new Error(`[milvusService] Schema verification failed: embedding dim is ${actualDim}, expected ${EMBEDDING_DIM}.`);
  }

  logger.success(`Schema verified: ${fields.length} fields, embedding=FloatVector(dim=${actualDim}).`);

  return {
    created:        created,
    fieldsVerified: fields.length,
    loaded:         true,
  };
};

const EXPECTED_RECORD_COUNT = 88;

// Bulk-insert the 88 GS-17 records (idempotent)
const insertRecords = async () => {
  logger.info(`Checking current record count in "${COLLECTION_NAME}" (via query)...`);

  const checkResult = await milvusClient.query({
    collection_name: COLLECTION_NAME,
    filter:          'schedule_number == "GS-17"',
    output_fields:   ['series_number'],
    limit:           EXPECTED_RECORD_COUNT + 10,
  });

  const currentCount = checkResult.data.length;
  logger.info(`Current record count: ${currentCount}`);

  if (currentCount >= EXPECTED_RECORD_COUNT) {
    logger.info(`${currentCount} records already exist in "${COLLECTION_NAME}" — skipping insertion.`);
    return {
      skipped:  true,
      inserted: 0,
      total:    currentCount,
    };
  }

  logger.info(`Loading dataset from: ${GS17_DATASET_PATH}`);
  const dataset = require(GS17_DATASET_PATH);
  const records = dataset.records;

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('[milvusService] gs-17.json loaded but "records" array is empty or missing.');
  }

  logger.info(`Dataset loaded: ${records.length} records found.`);

  const ZERO_VECTOR = new Array(EMBEDDING_DIM).fill(0);
  const rows = records.map((record) => ({
    schedule_number:           record.schedule_number,
    schedule_title:            record.schedule_title,
    series_number:             record.series_number,
    series_title:              record.series_title,
    series_description:        record.series_description,
    series_retention_period:   record.series_retention_period,
    series_disposition_method: record.series_disposition_method,
    text_to_embed:             record.text_to_embed,
    embedding:                 ZERO_VECTOR,
  }));

  logger.info(`Inserting ${rows.length} records into "${COLLECTION_NAME}"...`);
  const insertResult = await milvusClient.insert({
    collection_name: COLLECTION_NAME,
    data:            rows,
  });

  const insertedCount = Number(insertResult.insert_cnt);
  logger.success(`Inserted ${insertedCount} records into "${COLLECTION_NAME}".`);

  const finalCheck = await milvusClient.query({
    collection_name: COLLECTION_NAME,
    filter:          'schedule_number == "GS-17"',
    output_fields:   ['series_number'],
    limit:           EXPECTED_RECORD_COUNT + 10,
  });
  const finalCount = finalCheck.data.length;

  logger.success(`Final record count in "${COLLECTION_NAME}": ${finalCount}`);

  return {
    skipped:  false,
    inserted: insertedCount,
    total:    finalCount,
  };
};

// Generate and store real vector embeddings for all records
const populateEmbeddings = async () => {
  logger.info(`Fetching all records from "${COLLECTION_NAME}" for embedding population...`);

  const queryResult = await milvusClient.query({
    collection_name: COLLECTION_NAME,
    filter:          'schedule_number == "GS-17"',
    output_fields:   [
      'id',
      'schedule_number',
      'schedule_title',
      'series_number',
      'series_title',
      'series_description',
      'series_retention_period',
      'series_disposition_method',
      'text_to_embed',
    ],
    limit: 100,
  });

  const records = queryResult.data;
  if (!records || records.length === 0) {
    throw new Error('[milvusService] populateEmbeddings: no records found in collection. Run insertRecords() first.');
  }

  logger.info(`Found ${records.length} records to process.`);

  let generated = 0;
  let stored    = 0;
  const errors  = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const label  = `[${i + 1}/${records.length}] series ${record.series_number}`;

    try {
      logger.info(`${label}: generating embedding...`);
      const vector = await generateEmbedding(record.text_to_embed, { useContext: false });

      if (!Array.isArray(vector)) {
        throw new Error('generateEmbedding() did not return an array.');
      }

      if (vector.length !== EMBEDDING_DIM) {
        throw new Error(`Dimension mismatch: expected ${EMBEDDING_DIM}, got ${vector.length}.`);
      }

      const isAllZeros = vector.every(v => v === 0);
      if (isAllZeros) {
        throw new Error('generateEmbedding() returned an all-zero vector (placeholder check failed).');
      }

      generated++;
      logger.info(`${label}: embedding valid (dim=${vector.length}). Upserting...`);

      await milvusClient.upsert({
        collection_name: COLLECTION_NAME,
        data: [{
          id:                        record.id,
          schedule_number:           record.schedule_number,
          schedule_title:            record.schedule_title,
          series_number:             record.series_number,
          series_title:              record.series_title,
          series_description:        record.series_description,
          series_retention_period:   record.series_retention_period,
          series_disposition_method: record.series_disposition_method,
          text_to_embed:             record.text_to_embed,
          embedding:                 vector,
        }],
      });

      stored++;
      logger.success(`${label}: stored. (${stored}/${records.length} done)`);
    } catch (err) {
      const failureMessage = `${label}: FAILED — ${err.message}`;
      logger.error(failureMessage);
      errors.push({
        series_number: record.series_number,
        message:       err.message,
      });
    }
  }

  const failed = errors.length;
  if (failed === 0) {
    logger.success(`populateEmbeddings complete: ${generated} generated, ${stored} stored, 0 failures.`);
  } else {
    logger.warn(`populateEmbeddings finished with ${failed} failure(s). ${stored} records updated successfully.`);
  }

  return {
    generated: generated,
    stored:    stored,
    failed:    failed,
    errors:    errors,
  };
};

const SEARCH_LIMIT = 3;

// Vector similarity search against GS-17 collection
const searchSimilarRecords = async (cleanedText, limit = SEARCH_LIMIT) => {
  if (typeof cleanedText !== 'string' || cleanedText.trim().length === 0) {
    throw new Error(`[milvusService] searchSimilarRecords() requires a non-empty string. Received: ${JSON.stringify(cleanedText)}`);
  }

  logger.info(`Generating query embedding for similarity search...`);

  let queryVector;
  try {
    queryVector = await generateEmbedding(cleanedText, { useContext: false });
  } catch (embErr) {
    throw new Error(
      `[milvusService] searchSimilarRecords: embedding generation failed. Input text (first 80 chars): "${cleanedText.slice(0, 80)}". Original error: ${embErr.message}`
    );
  }

  logger.info(`Query embedding ready (dim=${queryVector.length}). Searching Milvus (limit=${limit}, nprobe=32)...`);

  let searchResult;
  try {
    searchResult = await milvusClient.search({
      collection_name:   COLLECTION_NAME,
      data:              [queryVector],
      limit:             limit,
      consistency_level: 'Strong',
      params:            { nprobe: 32 },
      output_fields:     [
        'series_number',
        'schedule_number',
        'schedule_title',
        'series_title',
        'series_description',
        'series_retention_period',
        'series_disposition_method',
      ],
    });
  } catch (searchErr) {
    logger.warn(`Milvus search with nprobe:32 warning: ${searchErr.message}. Retrying standard search...`);
    try {
      searchResult = await milvusClient.search({
        collection_name:   COLLECTION_NAME,
        data:              [queryVector],
        limit:             limit,
        consistency_level: 'Strong',
        output_fields:     [
          'series_number',
          'schedule_number',
          'schedule_title',
          'series_title',
          'series_description',
          'series_retention_period',
          'series_disposition_method',
        ],
      });
    } catch (fallbackErr) {
      throw new Error(
        `[milvusService] searchSimilarRecords: Milvus search failed. Input text (first 80 chars): "${cleanedText.slice(0, 80)}". Original error: ${fallbackErr.message}`
      );
    }
  }

  const rawResults = searchResult.results;
  if (!rawResults || rawResults.length === 0) {
    throw new Error('[milvusService] searchSimilarRecords: Milvus returned no results. The collection may be empty or not loaded.');
  }

  const candidates = rawResults.map((hit, index) => {
    const score = hit.score;
    if (typeof score !== 'number' || isNaN(score)) {
      throw new Error(`[milvusService] searchSimilarRecords: result[${index}] has invalid score: ${score}`);
    }

    const required = [
      'series_number', 'schedule_number', 'schedule_title',
      'series_title',  'series_description',
      'series_retention_period', 'series_disposition_method',
    ];

    for (const field of required) {
      if (hit[field] === null || hit[field] === undefined) {
        throw new Error(`[milvusService] searchSimilarRecords: result[${index}] is missing required field "${field}".`);
      }
    }

    return {
      series_number:             hit.series_number,
      schedule_number:           hit.schedule_number,
      schedule_title:            hit.schedule_title,
      series_title:              hit.series_title,
      series_description:        hit.series_description,
      series_retention_period:   hit.series_retention_period,
      series_disposition_method: hit.series_disposition_method,
      similarity_score:          score,
    };
  });

  // Ensure results are sorted in descending order of similarity
  for (let i = 0; i < candidates.length - 1; i++) {
    if (candidates[i].similarity_score < candidates[i + 1].similarity_score) {
      candidates.sort((a, b) => b.similarity_score - a.similarity_score);
      logger.warn('searchSimilarRecords: results were not pre-sorted; re-sorted by similarity_score.');
      break;
    }
  }

  logger.success(
    `Search complete. Top ${candidates.length} results: ` +
    candidates.map((c, i) => `[${i + 1}] ${c.series_number} (score=${c.similarity_score.toFixed(4)})`).join(', ')
  );

  return candidates;
};

// Retrieve complete metadata for a series number from Milvus, with local fallback across all schedules
const getFullRecord = async (seriesNumber) => {
  if (!seriesNumber || typeof seriesNumber !== 'string') {
    throw new Error('[milvusService] getFullRecord() requires a non-empty string seriesNumber.');
  }

  const cleanSeriesNum = seriesNumber.trim();
  logger.info(`Fetching complete record metadata for series_number: "${cleanSeriesNum}"...`);

  // Lookup in Milvus
  try {
    const queryResult = await milvusClient.query({
      collection_name: COLLECTION_NAME,
      filter:          `series_number == "${cleanSeriesNum}"`,
      output_fields:   [
        'schedule_number',
        'schedule_title',
        'series_number',
        'series_title',
        'series_description',
        'series_retention_period',
        'series_disposition_method',
      ],
      limit: 1,
    });

    if (queryResult && Array.isArray(queryResult.data) && queryResult.data.length > 0) {
      const rec = queryResult.data[0];
      logger.success(`Found metadata for series "${cleanSeriesNum}" in Milvus.`);
      return {
        schedule_number:    rec.schedule_number,
        schedule_title:     rec.schedule_title,
        series_number:      rec.series_number,
        series_title:       rec.series_title,
        series_description: rec.series_description,
        retention_period:   rec.series_retention_period,
        disposition_method: rec.series_disposition_method,
      };
    }

    logger.warn(`Series "${cleanSeriesNum}" not found in Milvus. Trying local schedule files fallback...`);
  } catch (milvusErr) {
    logger.warn(`Milvus query failed for series "${cleanSeriesNum}": ${milvusErr.message}. Trying local fallback...`);
  }

  // Fallback: scan all local schedule JSON files
  try {
    const allRecords = loadAllScheduleRecords();
    const foundRecord = allRecords.find(r => String(r.series_number).trim() === cleanSeriesNum);

    if (foundRecord) {
      logger.success(`Found metadata for series "${cleanSeriesNum}" in local schedule files.`);
      return {
        schedule_number:    foundRecord.schedule_number,
        schedule_title:     foundRecord.schedule_title,
        series_number:      foundRecord.series_number,
        series_title:       foundRecord.series_title,
        series_description: foundRecord.series_description,
        retention_period:   foundRecord.series_retention_period,
        disposition_method: foundRecord.series_disposition_method,
      };
    }
  } catch (fileErr) {
    logger.error(`Fallback lookup in schedule files failed for series "${cleanSeriesNum}":`, fileErr);
  }

  throw new Error(`[milvusService] Series number "${cleanSeriesNum}" was not found in Milvus or local schedule files.`);
};

module.exports = {
  milvusClient,
  verifyConnection,
  ensureCollection,
  insertRecords,
  populateEmbeddings,
  searchSimilarRecords,
  getFullRecord,
};

