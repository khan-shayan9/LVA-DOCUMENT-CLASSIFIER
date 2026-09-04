// Benchmark vector retrieval performance across all 88 GS-17 series
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
const GS17_PATH       = path.resolve(__dirname, '../data/schedules/gs-17.json');

// Terminal formatting helpers
const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m' };
const ok   = (s) => `${C.green}✔${C.reset} ${s}`;
const fail = (s) => `${C.red}✘${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const info = (s) => `${C.cyan}→${C.reset} ${s}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;
const dim  = (s) => `${C.grey}${s}${C.reset}`;

// Generate embeddings using Workers AI
async function generateEmbedding(text) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Embedding API HTTP ${resp.status}: ${errText}`);
  }
  const json = await resp.json();
  if (!json.success || !json.result || !json.result.data) {
    throw new Error(`Embedding API error: ${JSON.stringify(json.errors)}`);
  }
  return json.result.data[0];
}

async function main() {
  console.log(`\n${bold('  🎯 GS-17 Schedule: 88-Record Retrieval Benchmark')}`);
  console.log(dim(`  Testing all 88 records in collection "${COLLECTION_NAME}"\n`));

  // Load dataset
  let dataset;
  try {
    dataset = require(GS17_PATH);
  } catch (err) {
    console.error(fail(`Failed to load gs-17.json: ${err.message}`));
    process.exit(1);
  }

  const records = dataset.records || [];
  console.log(info(`Loaded ${records.length} series definitions from gs-17.json`));

  // Connect to Milvus
  const client = new MilvusClient({ address: MILVUS_ADDRESS, token: MILVUS_TOKEN });
  try {
    await client.getVersion();
    await client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log(ok(`Connected to Milvus & collection loaded\n`));
  } catch (err) {
    console.error(fail(`Milvus connection error: ${err.message}`));
    process.exit(1);
  }

  let rank1Count = 0;
  let top3Count  = 0;
  let top5Count  = 0;
  let failCount  = 0;

  const failureList = [];

  console.log(bold('  Running queries across all 88 series...'));
  console.log(dim('  --------------------------------------------------'));

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const seriesNum = String(rec.series_number).trim();

    // Construct realistic simulation text for current series
    const queryText = `${rec.series_title}. Series ${seriesNum}. ${rec.series_description} Schedule: GS-17 law enforcement fire emergency services record.`;

    try {
      const queryVec = await generateEmbedding(queryText);

      const searchRes = await client.search({
        collection_name: COLLECTION_NAME,
        data:            [queryVec],
        anns_field:      'embedding',
        limit:           5,
        metric_type:     MetricType.COSINE,
        params:          { nprobe: 32 },
        output_fields:   ['series_number', 'series_title'],
      });

      const hits = searchRes.results || [];
      const rank = hits.findIndex(h => String(h.series_number).trim() === seriesNum);

      const numStr = `[${(i + 1).toString().padStart(2)}/88] ${seriesNum}`;

      if (rank === 0) {
        rank1Count++;
        top3Count++;
        top5Count++;
        const score = (hits[0].score * 100).toFixed(1);
        console.log(`  ${numStr}  ${C.green}Rank 1${C.reset}  (${score}%)  "${rec.series_title.slice(0, 45)}"`);
      } else if (rank > 0 && rank < 3) {
        top3Count++;
        top5Count++;
        const score = (hits[rank].score * 100).toFixed(1);
        console.log(`  ${numStr}  ${C.cyan}Rank ${rank + 1}${C.reset}  (${score}%)  "${rec.series_title.slice(0, 45)}"  (Top hit: ${hits[0].series_number})`);
      } else if (rank >= 3 && rank < 5) {
        top5Count++;
        console.log(`  ${numStr}  ${C.yellow}Rank ${rank + 1}${C.reset}  "${rec.series_title.slice(0, 45)}"  (Top hit: ${hits[0].series_number})`);
      } else {
        failCount++;
        console.log(`  ${numStr}  ${C.red}NOT IN TOP 5${C.reset}  "${rec.series_title.slice(0, 45)}"  (Top hit: ${hits[0]?.series_number})`);
        failureList.push({
          series_number: seriesNum,
          title: rec.series_title,
          topHit: hits[0] ? `${hits[0].series_number} "${hits[0].series_title}"` : 'None',
        });
      }

      // Small throttle to avoid hitting API rate limits
      if (i < records.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }

    } catch (err) {
      console.log(`  [${i + 1}/88] ${seriesNum}  ${C.red}ERROR: ${err.message}${C.reset}`);
      failCount++;
      failureList.push({ series_number: seriesNum, title: rec.series_title, topHit: `ERROR: ${err.message}` });
    }
  }

  // Summary results
  console.log(`\n${bold('==================================================')}`);
  console.log(bold('  📊 88-RECORD BENCHMARK RESULTS SUMMARY'));
  console.log(bold('=================================================='));
  console.log(`  Total Series Tested : ${records.length}`);
  console.log(`  Rank 1 Accuracy     : ${rank1Count === records.length ? C.green : C.cyan}${rank1Count} / ${records.length} (${((rank1Count / records.length) * 100).toFixed(1)}%)${C.reset}`);
  console.log(`  Top-3 Inclusion     : ${top3Count === records.length ? C.green : C.yellow}${top3Count} / ${records.length} (${((top3Count / records.length) * 100).toFixed(1)}%)${C.reset}`);
  console.log(`  Top-5 Inclusion     : ${top5Count} / ${records.length} (${((top5Count / records.length) * 100).toFixed(1)}%)`);
  console.log(`  Failed (> Rank 5)   : ${failCount === 0 ? C.green + '0' : C.red + failCount}${C.reset}`);

  if (failureList.length > 0) {
    console.log(`\n${bold('  Series needing further tuning:')}`);
    failureList.forEach(f => {
      console.log(`    • ${f.series_number} "${f.title}" — Top hit: ${f.topHit}`);
    });
  } else {
    console.log(`\n${ok('All 88 series are retrievable with high accuracy across the GS-17 schedule!')}`);
  }

  console.log('');
}

main().catch(err => {
  console.error(`\n${C.red}Fatal error:${C.reset}`, err.message);
  process.exit(1);
});

