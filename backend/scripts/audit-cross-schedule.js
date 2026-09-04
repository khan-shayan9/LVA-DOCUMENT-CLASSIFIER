// Proactive ambiguity audit for GS-02 and GS-14 series.
// For each series, generates a synthetic police-department-letterhead document
// based on that series' own title/description, then checks if it appears in the
// top-8 Milvus results. Any series missing from top-8 needs text_to_embed enrichment.
// Run: node backend/scripts/audit-cross-schedule.js
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
const SEARCH_LIMIT    = 8; // matches uploadController.js SEARCH_CANDIDATE_LIMIT

const DELAY_MS = 350; // avoid Cloudflare rate-limiting

// ── Color helpers ─────────────────────────────────────────────────────────────
const C    = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m' };
const ok   = (s) => `${C.green}✔${C.reset} ${s}`;
const fail = (s) => `${C.red}✘${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;
const dim  = (s) => `${C.grey}${s}${C.reset}`;

// ── Embedding API ─────────────────────────────────────────────────────────────
async function generateEmbedding(text) {
  const url  = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  const vec = json.result.data[0];
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) throw new Error(`Dim mismatch: ${vec?.length}`);
  return vec;
}

// ── Build a synthetic police-letterhead document for a series ─────────────────
// This simulates a document submitted to the system that belongs to this series
// but is stamped with "CHESTERFIELD COUNTY POLICE DEPARTMENT" at the top —
// the hardest case for cross-schedule disambiguation.
function buildSyntheticDoc(rec) {
  return `CHESTERFIELD COUNTY POLICE DEPARTMENT
RECORDS RETENTION DOCUMENT — ${rec.series_title.toUpperCase()}
Schedule: ${rec.schedule_number}  Series: ${rec.series_number}
Status: Active

${rec.series_description}

This document covers records related to: ${rec.series_title}.
Record retention period: ${rec.series_retention_period}.
Disposition: ${rec.series_disposition_method}.
Key terms from series: ${(rec.key_criteria || []).slice(0, 5).join(', ')}.`;
}

// ── Load all GS-02 and GS-14 records ─────────────────────────────────────────
function loadTargetSchedules() {
  const targets = ['gs-02.json', 'gs-14.json'];
  const records = [];
  for (const f of targets) {
    const filePath = path.join(SCHEDULES_DIR, f);
    if (!fs.existsSync(filePath)) { console.log(warn(`File not found: ${f}`)); continue; }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    records.push(...(data.records || []));
  }
  return records;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${bold('  🔍 Cross-Schedule Ambiguity Audit (GS-02 + GS-14)')}`);
  console.log(dim(`  Simulates police-letterhead documents for every series.`));
  console.log(dim(`  A series PASSES if it appears in the top-${SEARCH_LIMIT} Milvus results.\n`));

  const client = new MilvusClient({ address: MILVUS_ADDRESS, token: MILVUS_TOKEN });
  await client.loadCollection({ collection_name: COLLECTION_NAME });

  const records = loadTargetSchedules();
  console.log(`  Testing ${records.length} series across GS-02 + GS-14...\n`);

  const passing = [];
  const failing = []; // not in top-8
  const risky   = []; // in top-8 but rank 6-8 (could be pushed out)

  for (let i = 0; i < records.length; i++) {
    const rec   = records[i];
    const label = `[${String(i+1).padStart(2)}/${records.length}] ${rec.schedule_number} ${rec.series_number.padEnd(8)} "${rec.series_title.slice(0, 40)}"`;
    process.stdout.write(`  ${label} ... `);

    try {
      const doc = buildSyntheticDoc(rec);
      const vec = await generateEmbedding(doc);

      const res = await client.search({
        collection_name: COLLECTION_NAME,
        data:            [vec],
        limit:           SEARCH_LIMIT,
        output_fields:   ['series_number', 'schedule_number', 'series_title'],
      });

      const rank = res.results.findIndex(r => r.series_number === rec.series_number);

      if (rank === -1) {
        process.stdout.write(`${C.red}FAIL (not in top-${SEARCH_LIMIT})${C.reset}\n`);
        failing.push({ rec, topResult: res.results[0] });
      } else if (rank >= 5) {
        process.stdout.write(`${C.yellow}RISKY (rank ${rank+1})${C.reset}\n`);
        risky.push({ rec, rank: rank + 1 });
      } else {
        process.stdout.write(`${C.green}PASS (rank ${rank+1})${C.reset}\n`);
        passing.push({ rec, rank: rank + 1 });
      }

    } catch (e) {
      process.stdout.write(`${C.red}ERROR: ${e.message}${C.reset}\n`);
    }

    if (i < records.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(65)}`);
  console.log(bold('  AUDIT RESULTS'));
  console.log(`${'─'.repeat(65)}`);
  console.log(`  ${C.green}PASS${C.reset}  : ${passing.length} series`);
  console.log(`  ${C.yellow}RISKY${C.reset} : ${risky.length} series (in top-8 but rank ≥ 6, vulnerable)`);
  console.log(`  ${C.red}FAIL${C.reset}  : ${failing.length} series (not in top-8, need enrichment)`);

  if (risky.length > 0) {
    console.log(`\n${bold('  ⚠ RISKY series (add to reenrich-series.js as precaution):')}`);
    for (const { rec, rank } of risky) {
      console.log(`    ${rec.schedule_number} ${rec.series_number.padEnd(8)} rank=${rank}  "${rec.series_title}"`);
      console.log(dim(`      ${rec.text_to_embed.slice(0, 100)}...`));
    }
  }

  if (failing.length > 0) {
    console.log(`\n${bold('  ✘ FAILING series (must enrich — add to reenrich-series.js):')}`);
    for (const { rec, topResult } of failing) {
      console.log(`    ${rec.schedule_number} ${rec.series_number.padEnd(8)} "${rec.series_title}"`);
      console.log(dim(`      Current text_to_embed (first 120 chars):`));
      console.log(dim(`      ${rec.text_to_embed.slice(0, 120)}...`));
      if (topResult) {
        console.log(dim(`      Top result was: ${topResult.schedule_number} ${topResult.series_number} "${topResult.series_title}"`));
      }
    }
  }

  if (failing.length === 0 && risky.length === 0) {
    console.log(`\n${ok('All GS-02 and GS-14 series pass the cross-schedule disambiguation test!')}`);
  } else {
    console.log(`\n${warn('Add failing/risky series to backend/scripts/reenrich-series.js UPDATES map and run it.')}`);
  }

  console.log('');
}

main().catch(err => {
  console.error(`\n${C.red}Fatal:${C.reset} ${err.message}`);
  process.exit(1);
});
