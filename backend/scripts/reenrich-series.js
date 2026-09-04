// Upserts enriched text_to_embed for one or more series across any schedule.
// Reads updated text from UPDATES map, re-embeds, and upserts in Milvus.
// Run: node backend/scripts/reenrich-series.js
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

const MILVUS_ADDRESS  = process.env.MILVUS_ADDRESS;
const MILVUS_TOKEN    = process.env.MILVUS_TOKEN;
const CF_ACCOUNT_ID   = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN    = process.env.CLOUDFLARE_API_TOKEN;
const COLLECTION_NAME = 'gs17_records';
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIM   = 768;
const SCHEDULES_DIR   = path.resolve(__dirname, '../data/schedules');

// ── Enrichment updates (series_number → new text_to_embed) ───────────────────
// Add any series here that need better cross-schedule disambiguation.
const UPDATES = {

  // GS-02: Fixed Assets Files
  // Problem: "Police Department" header pulls documents toward GS-17.
  // Fix: Explicitly mention that all locality agencies (incl. law enforcement)
  //       own fixed assets documented in this series.
  '010163': `Fixed Assets Files (Series 010163, GS-02 Fiscal Records): Administrative fiscal record documenting the control and inventory of fixed assets owned by any locality agency — including police departments, fire departments, sheriff offices, and all other municipal departments. This is NOT a law enforcement investigative record. Retention: retain until asset is sold or no longer in use. Records include: fixed asset log, property inventory, equipment inventory, land parcel records, building records, capital asset reconciliation, asset management system entries, maps, deeds, maintenance schedules, newly acquired property documentation, asset disposal records. Covers tracking of agency-owned buildings, land, vehicles, and major equipment. The content describes asset management, property accounting, and fiscal control — not criminal investigations, arrests, incidents, or law enforcement operations.`,

};

// ── Color helpers ─────────────────────────────────────────────────────────────
const C    = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const ok   = (s) => `${C.green}✔${C.reset} ${s}`;
const fail = (s) => `${C.red}✘${C.reset} ${s}`;
const info = (s) => `${C.cyan}→${C.reset} ${s}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

// ── Embedding API ─────────────────────────────────────────────────────────────
async function generateEmbedding(text) {
  const url  = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error(`Embedding API HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.success) throw new Error(`Embedding API error: ${JSON.stringify(json.errors)}`);
  const vec = json.result.data[0];
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) throw new Error(`Unexpected dim: ${vec?.length}`);
  return vec;
}

// ── Load all schedule records (to update local JSON files too) ────────────────
function loadAllRecords() {
  const map = {};
  const files = fs.readdirSync(SCHEDULES_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const filePath = path.join(SCHEDULES_DIR, f);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const r of (data.records || [])) {
      map[r.series_number] = { record: r, filePath, data };
    }
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${bold('  🔧 Re-enrich Series text_to_embed + Re-embed')}\n`);

  const seriesNumbers = Object.keys(UPDATES);
  console.log(info(`Series to update: ${seriesNumbers.join(', ')}\n`));

  // Connect to Milvus
  const client = new MilvusClient({ address: MILVUS_ADDRESS, token: MILVUS_TOKEN });
  const ver = await client.getVersion();
  console.log(ok(`Connected to Milvus (${ver.version})`));
  await client.loadCollection({ collection_name: COLLECTION_NAME });

  // Load all local schedule records
  const allRecords = loadAllRecords();

  let success = 0;
  const errors = [];

  for (const seriesNum of seriesNumbers) {
    const newText = UPDATES[seriesNum].trim();
    console.log(`\n${bold(seriesNum)}`);

    // 1. Fetch Milvus record for the series
    const q = await client.query({
      collection_name: COLLECTION_NAME,
      filter:          `series_number == "${seriesNum}"`,
      output_fields:   ['id', 'schedule_number', 'schedule_title', 'series_number',
                        'series_title', 'series_description', 'series_retention_period',
                        'series_disposition_method'],
      limit: 1,
    });

    if (!q.data || q.data.length === 0) {
      console.log(fail(`Series ${seriesNum} not found in Milvus — skipping`));
      errors.push(seriesNum);
      continue;
    }

    const milvus = q.data[0];
    console.log(info(`Found in Milvus: "${milvus.series_title}" (${milvus.schedule_number})`));

    // 2. Embed new text
    process.stdout.write(`  Embedding ... `);
    let vector;
    try {
      vector = await generateEmbedding(newText);
      process.stdout.write(`dim=${vector.length}  `);
    } catch (e) {
      console.log(fail(`Embedding failed: ${e.message}`));
      errors.push(seriesNum);
      continue;
    }

    // 3. Upsert in Milvus
    process.stdout.write(`Upserting in Milvus ... `);
    try {
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
          text_to_embed:             newText,
          embedding:                 vector,
        }],
      });
      process.stdout.write(`${C.green}done${C.reset}\n`);
    } catch (e) {
      console.log(fail(`Milvus upsert failed: ${e.message}`));
      errors.push(seriesNum);
      continue;
    }

    // 4. Update local JSON file
    const entry = allRecords[seriesNum];
    if (entry) {
      entry.record.text_to_embed = newText;
      fs.writeFileSync(entry.filePath, JSON.stringify(entry.data, null, 2), 'utf8');
      console.log(ok(`Local JSON updated: ${path.basename(entry.filePath)}`));
    } else {
      console.log(`  ${C.yellow}⚠${C.reset} Series ${seriesNum} not found in local JSON files`);
    }

    success++;
  }

  console.log(`\n${bold('  Summary:')}`);
  console.log(`  Updated : ${C.green}${success}${C.reset}`);
  if (errors.length > 0) console.log(`  Errors  : ${C.red}${errors.join(', ')}${C.reset}`);
  console.log('');
  if (success === seriesNumbers.length) console.log(ok('All series re-enriched and re-embedded!'));
}

main().catch(err => {
  console.error(`\n${C.red}Fatal:${C.reset} ${err.message}`);
  process.exit(1);
});
