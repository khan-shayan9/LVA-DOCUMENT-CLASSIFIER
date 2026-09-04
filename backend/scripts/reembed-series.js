// Targeted re-embedding script for specific GS-17 series
'use strict';

require('dotenv').config();

const path = require('path');
const { MilvusClient, MetricType } = require('@zilliz/milvus2-sdk-node');

const MILVUS_ADDRESS  = process.env.MILVUS_ADDRESS;
const MILVUS_TOKEN    = process.env.MILVUS_TOKEN;
const CF_ACCOUNT_ID   = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN    = process.env.CLOUDFLARE_API_TOKEN;
const COLLECTION_NAME = 'gs17_records';
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIM   = 768;
const GS17_PATH       = path.resolve(__dirname, '../data/schedules/gs-17.json');

// Target series to re-embed
const TARGET_SERIES = ['100779', '100755', '200151'];


// ── Colors ────────────────────────────────────────────────────
const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m' };
const ok   = (s) => `${C.green}✔${C.reset} ${s}`;
const fail = (s) => `${C.red}✘${C.reset} ${s}`;
const info = (s) => `${C.cyan}→${C.reset} ${s}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

// ── Embedding helper ──────────────────────────────────────────
async function generateEmbedding(text) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Embedding API HTTP ${resp.status}: ${errText}`);
  }
  const json = await resp.json();
  if (!json.success || !json.result || !json.result.data) {
    throw new Error(`Embedding API failure: ${JSON.stringify(json.errors)}`);
  }
  const vec = json.result.data[0];
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
    throw new Error(`Unexpected embedding shape: got length ${Array.isArray(vec) ? vec.length : 'non-array'}`);
  }
  if (vec.every(v => v === 0)) {
    throw new Error('Embedding API returned an all-zero vector.');
  }
  return vec;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {

  console.log(`\n${bold('  🔄 Targeted Re-Embedding Script')}`);
  console.log(`  Series: ${TARGET_SERIES.join(', ')}\n`);

  // Load gs-17.json
  let gs17Dataset;
  try {
    gs17Dataset = require(GS17_PATH);
  } catch (e) {
    console.log(fail(`Cannot load gs-17.json: ${e.message}`));
    process.exit(1);
  }

  // Find target records
  const targetRecords = TARGET_SERIES.map(ts => {
    const rec = (gs17Dataset.records || []).find(r => String(r.series_number).trim() === ts);
    if (!rec) {
      console.log(fail(`Series ${ts} not found in gs-17.json`));
      process.exit(1);
    }
    return rec;
  });

  console.log(info('Records found in gs-17.json:'));
  targetRecords.forEach(r => {
    console.log(`  • ${r.series_number}  "${r.series_title}"`);
    console.log(`    text_to_embed (first 120 chars): "${String(r.text_to_embed).slice(0, 120)}..."`);
  });
  console.log('');

  // Connect to Milvus
  const client = new MilvusClient({ address: MILVUS_ADDRESS, token: MILVUS_TOKEN });
  try {
    const ver = await client.getVersion();
    console.log(ok(`Connected to Milvus (version ${ver.version})`));
  } catch (e) {
    console.log(fail(`Cannot connect to Milvus: ${e.message}`));
    process.exit(1);
  }

  await client.loadCollection({ collection_name: COLLECTION_NAME });
  console.log(ok(`Collection "${COLLECTION_NAME}" loaded`));
  console.log('');

  // Fetch existing Milvus records to get their IDs
  const milvusRecords = [];
  for (const rec of targetRecords) {
    const qResult = await client.query({
      collection_name: COLLECTION_NAME,
      filter:          `series_number == "${rec.series_number}"`,
      output_fields:   ['id', 'series_number', 'series_title', 'schedule_number', 'schedule_title',
                        'series_description', 'series_retention_period', 'series_disposition_method', 'text_to_embed'],
      limit: 1,
    });
    if (!qResult.data || qResult.data.length === 0) {
      console.log(fail(`Series ${rec.series_number} not found in Milvus — run insertRecords() first`));
      process.exit(1);
    }
    milvusRecords.push({ milvus: qResult.data[0], json: rec });
  }

  // Generate and upsert embeddings
  let success = 0;
  for (const { milvus, json } of milvusRecords) {
    const label = `${json.series_number}  "${json.series_title}"`;
    process.stdout.write(`  Embedding ${label} ... `);

    try {
      const vector = await generateEmbedding(json.text_to_embed);
      process.stdout.write(`dim=${vector.length}  Upserting ... `);

      await client.upsert({
        collection_name: COLLECTION_NAME,
        data: [{
          id:                        milvus.id,
          schedule_number:           milvus.schedule_number,
          schedule_title:            milvus.schedule_title,
          series_number:             milvus.series_number,
          series_title:              milvus.series_title,
          series_description:        milvus.series_description,
          series_retention_period:   milvus.series_retention_period,
          series_disposition_method: milvus.series_disposition_method,
          text_to_embed:             json.text_to_embed,   // write the new text
          embedding:                 vector,               // and its new embedding
        }],
      });

      process.stdout.write(`${C.green}done${C.reset}\n`);
      success++;

    } catch (e) {
      process.stdout.write(`${C.red}FAILED: ${e.message}${C.reset}\n`);
    }
  }

  console.log('');
  if (success === TARGET_SERIES.length) {
    console.log(ok(`All ${success} series successfully re-embedded and upserted into Milvus.`));
    console.log(info('Run the diagnostic again to verify retrieval improvement:'));
    console.log(`  ${C.grey}node scripts/diagnose-milvus.js${C.reset}`);
  } else {
    console.log(fail(`${TARGET_SERIES.length - success} series failed to re-embed. Check errors above.`));
  }
  console.log('');
}

main().catch(err => {
  console.error(`\n\x1b[31mFatal error:\x1b[0m ${err.message}`);
  process.exit(1);
});
