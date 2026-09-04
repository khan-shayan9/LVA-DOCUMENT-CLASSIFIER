// Ingests GS-02 and GS-14 records into the shared Milvus collection (gs17_records).
// Idempotent: checks for existing records before inserting.
// Run: node backend/scripts/ingest-new-schedules.js
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// ── Config ────────────────────────────────────────────────────
const MILVUS_ADDRESS  = process.env.MILVUS_ADDRESS;
const MILVUS_TOKEN    = process.env.MILVUS_TOKEN;
const CF_ACCOUNT_ID   = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN    = process.env.CLOUDFLARE_API_TOKEN;
const COLLECTION_NAME = 'gs17_records';
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIM   = 768;
const DELAY_MS        = 300; // rate-limit delay between Cloudflare API calls

// JSON schedule files to ingest
const SCHEDULE_FILES = [
  path.resolve(__dirname, '../data/schedules/gs-02.json'),
  path.resolve(__dirname, '../data/schedules/gs-14.json'),
];

// ── Color helpers ─────────────────────────────────────────────
const C    = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m' };
const ok   = (s) => `${C.green}✔${C.reset} ${s}`;
const fail = (s) => `${C.red}✘${C.reset} ${s}`;
const info = (s) => `${C.cyan}→${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;
const dim  = (s) => `${C.grey}${s}${C.reset}`;

// ── Embedding API ─────────────────────────────────────────────
async function generateEmbedding(text) {
  const url  = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error(`Embedding API HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
  const json = await resp.json();
  if (!json.success) throw new Error(`Embedding API error: ${JSON.stringify(json.errors)}`);
  const vec = json.result.data[0];
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) throw new Error(`Unexpected dim: ${vec?.length}`);
  if (vec.every(v => v === 0)) throw new Error('All-zero vector returned');
  return vec;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n${bold('  📥 Multi-Schedule Ingestion: GS-02 + GS-14')}\n`);

  // 1. Validate env
  for (const [key, val] of Object.entries({ MILVUS_ADDRESS, MILVUS_TOKEN, CF_ACCOUNT_ID, CF_API_TOKEN })) {
    if (!val) { console.error(fail(`Missing env var: ${key}`)); process.exit(1); }
  }

  // 2. Load all schedule records
  const allRecords = [];
  for (const filePath of SCHEDULE_FILES) {
    if (!fs.existsSync(filePath)) {
      console.error(fail(`File not found: ${filePath}`));
      process.exit(1);
    }
    const data    = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const records = data.records || [];
    console.log(info(`Loaded ${records.length} records from ${path.basename(filePath)}`));
    allRecords.push(...records);
  }
  console.log(info(`Total records to process: ${allRecords.length}\n`));

  // 3. Connect to Milvus
  console.log(info('Connecting to Milvus...'));
  const client = new MilvusClient({ address: MILVUS_ADDRESS, token: MILVUS_TOKEN });
  try {
    const ver = await client.getVersion();
    console.log(ok(`Connected (version: ${ver.version})`));
  } catch (e) {
    console.error(fail(`Cannot connect to Milvus: ${e.message}`));
    process.exit(1);
  }

  await client.loadCollection({ collection_name: COLLECTION_NAME });
  console.log(ok(`Collection "${COLLECTION_NAME}" loaded\n`));

  // 4. Check which series already exist (skip to avoid duplicates)
  console.log(info('Checking for existing records...'));
  const toIngest = [];
  for (const rec of allRecords) {
    const q = await client.query({
      collection_name: COLLECTION_NAME,
      filter:          `series_number == "${rec.series_number}"`,
      output_fields:   ['series_number'],
      limit: 1,
    });
    if (q.data && q.data.length > 0) {
      console.log(dim(`  skip ${rec.series_number.padEnd(8)} "${rec.series_title}" — already exists`));
    } else {
      toIngest.push(rec);
    }
  }

  if (toIngest.length === 0) {
    console.log(`\n${ok('All records already exist in Milvus — nothing to insert.')}`);
    return;
  }
  console.log(`\n${ok(`${allRecords.length - toIngest.length} already exist, ${toIngest.length} new records to ingest`)}`);

  // 5. Embed and insert each new record
  console.log(`\n${bold(`  Embedding and inserting ${toIngest.length} records...`)}`);
  const estSec = Math.ceil(toIngest.length * (0.6 + DELAY_MS / 1000));
  console.log(dim(`  (Estimated time: ~${estSec}s)\n`));

  let success = 0;
  let errors  = 0;
  const errorLog = [];

  for (let i = 0; i < toIngest.length; i++) {
    const rec   = toIngest[i];
    const label = `[${i + 1}/${toIngest.length}] ${rec.schedule_number} ${rec.series_number.padEnd(8)} "${rec.series_title.slice(0, 45)}"`;
    process.stdout.write(`  ${label}\n    Embedding ... `);

    try {
      const vector = await generateEmbedding(rec.text_to_embed);
      process.stdout.write(`dim=${vector.length}  Inserting ... `);

      await client.insert({
        collection_name: COLLECTION_NAME,
        data: [{
          schedule_number:           rec.schedule_number,
          schedule_title:            rec.schedule_title,
          series_number:             rec.series_number,
          series_title:              rec.series_title,
          series_description:        rec.series_description,
          series_retention_period:   rec.series_retention_period,
          series_disposition_method: rec.series_disposition_method,
          text_to_embed:             rec.text_to_embed,
          embedding:                 vector,
        }],
      });

      process.stdout.write(`${C.green}done${C.reset}\n`);
      success++;

    } catch (e) {
      process.stdout.write(`${C.red}FAILED: ${e.message}${C.reset}\n`);
      errors++;
      errorLog.push({ series_number: rec.series_number, error: e.message });
    }

    // Rate-limit delay (skip after last item)
    if (i < toIngest.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // 6. Summary
  console.log(`\n${bold('  Summary:')}`);
  console.log(`  Total to ingest   : ${toIngest.length}`);
  console.log(`  Successfully done : ${C.green}${success}${C.reset}`);
  if (errors > 0) {
    console.log(`  Errors            : ${C.red}${errors}${C.reset}`);
    errorLog.forEach(e => console.log(`    ${fail(`${e.series_number}: ${e.error}`)}`));
  }

  // 7. Verify final counts per schedule
  console.log(`\n${info('Verifying counts in Milvus...')}`);
  const schedules = [...new Set(allRecords.map(r => r.schedule_number))];
  for (const sched of schedules) {
    const q = await client.query({
      collection_name: COLLECTION_NAME,
      filter:          `schedule_number == "${sched}"`,
      output_fields:   ['series_number'],
      limit:           200,
    });
    console.log(ok(`${sched}: ${q.data.length} records in Milvus`));
  }

  console.log('');
  if (success === toIngest.length) {
    console.log(ok('All new records successfully embedded and stored in Milvus!'));
  } else {
    console.log(warn('Some records failed. Re-run this script to retry only the missing ones.'));
  }
  console.log('');
}

main().catch(err => {
  console.error(`\n${C.red}Fatal error:${C.reset} ${err.message}`);
  process.exit(1);
});
