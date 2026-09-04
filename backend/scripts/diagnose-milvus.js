// Milvus embedding and retrieval diagnostic tool
'use strict';

require('dotenv').config();

const path = require('path');
const { MilvusClient, MetricType } = require('@zilliz/milvus2-sdk-node');

const MILVUS_ADDRESS    = process.env.MILVUS_ADDRESS;
const MILVUS_TOKEN      = process.env.MILVUS_TOKEN;
const CF_ACCOUNT_ID     = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN      = process.env.CLOUDFLARE_API_TOKEN;
const COLLECTION_NAME   = 'gs17_records';
const EMBEDDING_MODEL   = '@cf/baai/bge-base-en-v1.5';
const GS17_PATH         = path.resolve(__dirname, '../data/schedules/gs-17.json');

// Sample benchmark test documents
const SAMPLE_DOCS = [

  {
    label:          'Doc 1 — Arrest File: Adult',
    expectedSeries: '100713',
    expectedTitle:  'Arrest Files: Adult',
    text: `ARREST FILE - ADULT
Series Number: 100713
County: Fairfax County Police Department
Report Date: 03/15/2023
SUBJECT INFORMATION: Name: Michael James Rodriguez, DOB: 07/22/1985
ARREST DETAILS:
Arrest Date: 03/14/2023
Arresting Officer: Officer David Chen (Badge #4521)
Charges: Breaking and Entering (Felony), Larceny over $500 (Felony), Possession of Burglary Tools (Misdemeanor)
ARREST CIRCUMSTANCES:
The subject was apprehended at approximately 2300 hours at the residence of 4527 Maple Drive, Fairfax, VA.
Officers responded to an active burglary alarm. Subject found inside with stolen property valued at approximately $1,200.
PHOTOGRAPHS: Attached (mugshot, frontal and profile views)
DISPOSITION: Case Status: Convicted. Conviction Date: 09/12/2023. Sentence: 3 years incarceration.
RETENTION SCHEDULE: Retention Period: 100 Years after birth. Disposition Method: Confidential Destruction`,
  },
  {
    label:          'Doc 2 — Investigative Case File: Serious Offense (Resolved)',
    expectedSeries: '100771',
    expectedTitle:  'Investigative Case Files: Serious Offenses - Resolved',
    text: `INVESTIGATIVE CASE FILE - SERIOUS OFFENSE (RESOLVED)
Series Number: 100771
County: Prince William County Sheriff's Office. Case Number: 2023-SW-00847
INCIDENT SUMMARY: Case Type: Armed Robbery
Location: Convenience Store at 8900 Commerce Street, Woodbridge, VA
Incident Date: 01/10/2023
VICTIM INFORMATION: Name: Robert Chen, Injuries: Minor laceration on left temple
SUSPECT INFORMATION: Name: James Anthony Walters, Status: Arrested and Charged
EVIDENCE COLLECTED:
1. Surveillance footage (22 minutes) stored digitally
2. Weapon (9mm handgun) recovered from scene
3. Fingerprints (latent) lifted from cash register
4. DNA samples collected from suspect
5. Witness statements (3 statements documented)
CASE DISPOSITION: Status: CLOSED - RESOLVED. Outcome: Guilty plea entered.
Sentence: 12 years incarceration
RETENTION SCHEDULE: Retention Period: 75 Years after closed. Disposal Method: Confidential Destruction`,
  },
  {
    label:          'Doc 3 — Background Check Request',
    expectedSeries: '100772',
    expectedTitle:  'Background Checks',
    text: `BACKGROUND CHECK REQUEST AND RESULTS
Series Number: 100772
County: Loudoun County Police Department. Request Date: 04/22/2023
REQUESTOR INFORMATION:
Requesting Entity: Loudoun County Schools HR Department
Purpose: Employment Screening (Teaching Position)
SUBJECT INFORMATION: Name: Jennifer Nicole Morrison, DOB: 11/03/1988
BACKGROUND CHECK SCOPE: Criminal History Check, Credit Check, Employment Verification, Education Verification, Reference Checks
FINDINGS:
Criminal History: Local Records: No arrests or convictions. State Records: No arrests or convictions. Federal Records: None found.
Employment History: Lincoln Elementary School (2015-2020) - Confirmed Good Standing. Madison High School (2020-Present) - Excellent Performance.
Education Verification: Bachelor of Arts Education (University of Virginia) - Verified. Master of Education (George Mason University) - Verified.
References: Positive recommendations from former principals and professors.
CONCLUSION: All checks completed successfully. No disqualifying information found. Recommendation: APPROVED for employment.
RETENTION SCHEDULE: Retention Period: 3 Years after submission. Disposal Method: Confidential Destruction`,
  },
  {
    label:          'Doc 4 — Traffic Accident/Crash Report',
    expectedSeries: '100781',
    expectedTitle:  'Reports: Traffic Accident/Crash - Citizen',
    text: `TRAFFIC ACCIDENT/CRASH REPORT - CITIZEN VEHICLES
Series Number: 100781
County: Arlington County Police Department. Report Number: 2023-TRF-012547. Report Date: 05/18/2023
ACCIDENT DETAILS: Incident Date: 05/17/2023. Incident Time: 14:35 hours.
Location: Wilson Boulevard at N. Arlington Ridge Road, Arlington, VA
Weather Conditions: Clear, Dry. Speed Limit: 35 mph.
PRIMARY OFFICER: Officer James Rodriguez (Badge #2847). District: Central District
VEHICLE 1: Driver: Christopher Alan Hughes, 2019 Honda Civic, Damage: Moderate front-end damage
VEHICLE 2: Driver: Maria Santos Gonzalez, 2020 Toyota Camry, Damage: Moderate rear-end damage
ACCIDENT NARRATIVE:
Vehicle 1 traveling westbound on Wilson Boulevard failed to yield at traffic light, striking Vehicle 2 traveling northbound.
Impact occurred in center of intersection. Both drivers moved vehicles to safe location.
EMS responded and assessed both drivers. No serious injuries reported.
CONTRIBUTING FACTORS: Inattention to traffic signal. Failure to yield (Vehicle 1 driver).
CITATIONS: Failure to Obey Traffic Control Device (Violation Code 46.2-878)
ESTIMATED DAMAGES: Vehicle 1: $4,200. Vehicle 2: $3,800. Total: $8,000.
RETENTION SCHEDULE: Retention Period: 3 Years after event. Disposal Method: Confidential Destruction`,
  },
  {
    label:          'Doc 5 — Fire & Rescue Incident Report',
    expectedSeries: '007037',
    expectedTitle:  'Incident Reports: Emergency Services, Fire and Rescue',
    text: `INCIDENT REPORT - EMERGENCY SERVICES, FIRE AND RESCUE
Series Number: 007037
County: Fairfax County Fire & Rescue Department. Incident Number: 2023-FR-034521. Report Date: 02/14/2023
INCIDENT OVERVIEW: Incident Type: Structure Fire. Incident Date: 02/13/2023. Incident Time: 23:47 hours.
Location: 2340 Meadowbrook Lane, Fairfax, VA 22031
RESPONDING UNITS: Fire Engines: Engine 42, Engine 58, Engine 71. Ladder Trucks: Ladder 42. Paramedic Units: Medic 42, Medic 58.
Incident Commander: Captain Michael Torres (Station 42)
PROPERTY INFORMATION: Structure Type: Single-family residential home. Year Built: 1992. Occupied: Yes, 4 occupants.
OCCUPANT INFORMATION: Robert and Patricia Matthews. Evacuation Status: All occupants evacuated safely.
FIRE DETAILS: Point of Origin: Kitchen stovetop. Cause: Unattended cooking.
Fire Extent: Contained to kitchen area. Spread Prevention: Fire contained by sprinkler activation.
Extinguishment Method: Direct water application and ventilation.
DAMAGE ASSESSMENT: Estimated Loss: $145,000. Smoke Damage: Significant throughout structure.
SUMMARY: Oil ignited from unattended cooking. Occupants heard smoke alarm and immediately evacuated.
Fire Department arrival time was excellent, sprinkler system activated, limiting damage. No injuries or fatalities.
RETENTION SCHEDULE: Retention Period: 6 Years after event. Disposal Method: Confidential Destruction`,
  },
];

// ── Color helpers ────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',  bold: '\x1b[1m',
  green:  '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m',
  grey:   '\x1b[90m',
};
const ok    = (s) => `${C.green}✔${C.reset} ${s}`;
const fail  = (s) => `${C.red}✘${C.reset} ${s}`;
const warn  = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const info  = (s) => `${C.cyan}→${C.reset} ${s}`;
const bold  = (s) => `${C.bold}${s}${C.reset}`;
const dim   = (s) => `${C.grey}${s}${C.reset}`;

function sep(title) {
  const line = '─'.repeat(62);
  console.log(`\n${C.bold}${C.cyan}${line}${C.reset}`);
  if (title) console.log(`${C.bold}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${line}${C.reset}`);
}

// ── Embedding helper ─────────────────────────────────────────
async function generateEmbedding(text) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body:   JSON.stringify({ text }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Embedding API HTTP ${resp.status}: ${errText}`);
  }
  const json = await resp.json();
  if (!json.success || !json.result || !json.result.data) {
    throw new Error(`Embedding API returned failure: ${JSON.stringify(json.errors)}`);
  }
  return json.result.data[0];
}

// ── Vector norm ───────────────────────────────────────────────
function l2Norm(vec) {
  return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
}

// ── Main ──────────────────────────────────────────────────────
async function main() {

  console.log(`\n${bold('  🔬 Milvus Embedding & Retrieval Diagnostic')}`);
  console.log(dim(`  Collection : ${COLLECTION_NAME}`));
  console.log(dim(`  Embedding  : ${EMBEDDING_MODEL}\n`));

  // 0. Env check
  sep('0. Environment Check');
  const missing_env = [];
  if (!MILVUS_ADDRESS) missing_env.push('MILVUS_ADDRESS');
  if (!MILVUS_TOKEN)   missing_env.push('MILVUS_TOKEN');
  if (!CF_ACCOUNT_ID)  missing_env.push('CLOUDFLARE_ACCOUNT_ID');
  if (!CF_API_TOKEN)   missing_env.push('CLOUDFLARE_API_TOKEN');
  if (missing_env.length > 0) {
    missing_env.forEach(v => console.log(fail(`${v} is not set in .env`)));
    process.exit(1);
  }
  console.log(ok('All required env variables present'));

  // 1. Connection
  sep('1. Connection Health');
  const client = new MilvusClient({ address: MILVUS_ADDRESS, token: MILVUS_TOKEN });
  try {
    const ver = await client.getVersion();
    console.log(ok(`Connected to Milvus. Server version: ${ver.version}`));
  } catch (e) {
    console.log(fail(`Cannot connect: ${e.message}`));
    process.exit(1);
  }
  await client.loadCollection({ collection_name: COLLECTION_NAME });
  console.log(ok(`Collection "${COLLECTION_NAME}" loaded`));

  // 2. Record count
  sep('2. Record Count');
  const countResult = await client.query({
    collection_name: COLLECTION_NAME,
    filter:          'schedule_number == "GS-17"',
    output_fields:   ['series_number'],
    limit:           200,
  });
  const inMilvus = countResult.data.map(r => String(r.series_number).trim());
  const total    = inMilvus.length;
  const expected = 88;
  const countLabel = total === expected ? ok(`${total} / ${expected} ✓`) :
                     total > 0          ? warn(`${total} / ${expected} — ${expected - total} may be missing`) :
                                          fail('0 records found — run insertRecords() first');
  console.log(countLabel);
  if (total === 0) process.exit(1);

  // 3. Missing series
  sep('3. Missing Series — gs-17.json vs Milvus');
  let gs17Dataset;
  try {
    gs17Dataset = require(GS17_PATH);
  } catch (e) {
    console.log(fail(`Could not load gs-17.json: ${e.message}`));
    process.exit(1);
  }

  const allSeries      = (gs17Dataset.records || []).map(r => String(r.series_number).trim());
  const milvusSet      = new Set(inMilvus);
  const missingSeries  = allSeries.filter(s => !milvusSet.has(s));
  const targetSeries   = ['100713', '100771', '100772', '100781', '007037'];

  if (missingSeries.length === 0) {
    console.log(ok(`All ${allSeries.length} series from gs-17.json are present in Milvus`));
  } else {
    console.log(fail(`${missingSeries.length} series from gs-17.json are MISSING from Milvus:`));
    missingSeries.forEach(s => {
      const rec    = (gs17Dataset.records || []).find(r => String(r.series_number).trim() === s);
      const title  = rec ? rec.series_title : '(unknown)';
      const tag    = targetSeries.includes(s) ? `  ${C.red}← TEST DOCUMENT SERIES${C.reset}` : '';
      console.log(`    ${fail(`${s}  "${title}"${tag}`)}`);
    });
  }

  console.log('');
  console.log(bold('  Specific check — the 5 test-document series:'));
  for (const ts of targetSeries) {
    const rec   = (gs17Dataset.records || []).find(r => String(r.series_number).trim() === ts);
    const title = rec ? rec.series_title : '(not in gs-17.json)';
    const label = `${ts}  "${title}"`;
    console.log(`    ${milvusSet.has(ts) ? ok(label) : fail(label)}`);
  }

  // 4. Zero-vector / embedding health
  sep('4. Zero-Vector Detection (Un-Embedded Records)');
  console.log(info('Fetching embeddings from Milvus to check for zero-vectors...'));

  let embeddingData = null;
  try {
    const embResult = await client.query({
      collection_name: COLLECTION_NAME,
      filter:          'schedule_number == "GS-17"',
      output_fields:   ['series_number', 'series_title', 'embedding'],
      limit:           200,
    });
    embeddingData = embResult.data;
  } catch (e) {
    console.log(warn(`Could not fetch embeddings: ${e.message}. Skipping zero-vector check.`));
  }

  if (embeddingData) {
    const zeroRecords = [];
    const goodNorms   = [];

    for (const rec of embeddingData) {
      const vec = rec.embedding;
      if (!Array.isArray(vec) || vec.length === 0 || vec.every(v => v === 0)) {
        zeroRecords.push(rec);
      } else {
        goodNorms.push({ series_number: rec.series_number, norm: l2Norm(vec) });
      }
    }

    if (zeroRecords.length === 0) {
      console.log(ok(`All ${embeddingData.length} records have non-zero embeddings ✓`));
    } else {
      console.log(fail(`${zeroRecords.length} records have ZERO-VECTOR embeddings (not embedded):`));
      zeroRecords.forEach(r => {
        const tag = targetSeries.includes(String(r.series_number).trim()) ? `  ${C.red}← TEST DOCUMENT SERIES${C.reset}` : '';
        console.log(`    ${fail(`${r.series_number}  "${r.series_title}"${tag}`)}`);
      });
      console.log('');
      console.log(info('Fix: Run populateEmbeddings() to generate embeddings for these records.'));
    }

    // Norm stats
    if (goodNorms.length > 0) {
      const normVals = goodNorms.map(n => n.norm);
      const minNorm  = Math.min(...normVals).toFixed(4);
      const maxNorm  = Math.max(...normVals).toFixed(4);
      const avgNorm  = (normVals.reduce((a, b) => a + b, 0) / normVals.length).toFixed(4);
      console.log('');
      console.log(info(`Embedding L2 norm stats (${goodNorms.length} embedded records):`));
      console.log(`    Min : ${minNorm}  |  Max : ${maxNorm}  |  Avg : ${avgNorm}`);
      const suspicious = goodNorms.filter(n => n.norm < 0.1);
      if (suspicious.length > 0) {
        console.log(warn(`${suspicious.length} records have suspiciously low norm < 0.1 (may be degenerate):`));
        suspicious.forEach(r => {
          console.log(`    ${warn(`${r.series_number}  norm=${r.norm.toFixed(4)}`)}`);
        });
      }
    }
  }

  // 5. Series 200142 catch-all check
  sep('5. Series 200142 "Catch-All" Analysis');
  const rec200142 = (gs17Dataset.records || []).find(r => String(r.series_number).trim() === '200142');
  if (rec200142) {
    console.log(info(`Title        : "${rec200142.series_title}"`));
    const embedText = String(rec200142.text_to_embed || rec200142.series_description || '');
    console.log(info(`text_to_embed: "${embedText.slice(0, 200)}${embedText.length > 200 ? '...' : ''}"`));
    console.log('');
    console.log(warn('This series ranked #1 in ALL 5 test searches — investigate its embedding.'));
    console.log(warn('A very generic text_to_embed will make this series dominate all searches.'));
  } else {
    console.log(warn('Series 200142 not found in gs-17.json'));
  }

  // 6. Live search tests
  sep('6. Live Search Test — 5 Sample Documents');
  console.log(info('Running embedding + search for each document (5 API calls)...\n'));

  const searchResults = [];

  for (const doc of SAMPLE_DOCS) {
    process.stdout.write(`  ${bold(doc.label)}\n    Searching ... `);
    try {
      const queryVector = await generateEmbedding(doc.text);

      const searchResult = await client.search({
        collection_name: COLLECTION_NAME,
        data:            [queryVector],
        anns_field:      'embedding',
        limit:           5,
        metric_type:     MetricType.COSINE,
        params:          { nprobe: 32 },
        output_fields:   ['series_number', 'series_title'],
      });

      const hits = (searchResult.results || []);
      const rank = hits.findIndex(h => String(h.series_number).trim() === doc.expectedSeries);
      const foundInTop3 = rank >= 0 && rank < 3;
      const foundInTop5 = rank >= 0 && rank < 5;

      const statusLine = foundInTop3 ? `${C.green}✔ Found at rank ${rank + 1}${C.reset}` :
                         foundInTop5 ? `${C.yellow}⚠ Found at rank ${rank + 1} (outside top 3)${C.reset}` :
                                       `${C.red}✘ NOT found in top 5${C.reset}`;
      console.log(statusLine);

      hits.slice(0, 5).forEach((h, i) => {
        const isCorrect = String(h.series_number).trim() === doc.expectedSeries;
        const scorePct  = typeof h.score === 'number' ? `${(h.score * 100).toFixed(1)}%` : 'N/A';
        const tag       = isCorrect ? ` ${C.green}← CORRECT${C.reset}` : '';
        const marker    = isCorrect ? C.green : (i === 0 ? C.yellow : C.grey);
        console.log(`    ${marker}Rank ${i + 1}${C.reset}: ${h.series_number}  "${h.series_title}"  sim=${scorePct}${tag}`);
      });

      console.log(`    ${dim(`Expected: ${doc.expectedSeries} — "${doc.expectedTitle}"`)}`);
      console.log('');
      searchResults.push({ doc, hits, foundInTop3, foundInTop5, rank });

    } catch (e) {
      console.log(`${C.red}ERROR: ${e.message}${C.reset}\n`);
      searchResults.push({ doc, hits: [], foundInTop3: false, foundInTop5: false, rank: -1, error: e.message });
    }
  }

  // 7. Summary
  sep('7. Summary');
  const inTop3 = searchResults.filter(r => r.foundInTop3).length;
  const inTop5 = searchResults.filter(r => r.foundInTop5 && !r.foundInTop3).length;
  const absent = searchResults.filter(r => !r.foundInTop5 && !r.error).length;
  const errs   = searchResults.filter(r => r.error).length;

  console.log(`  ${bold('Retrieval Results:')}`);
  console.log(`    Correct series in Top 3 : ${inTop3 === SAMPLE_DOCS.length ? C.green : C.red}${inTop3} / ${SAMPLE_DOCS.length}${C.reset}`);
  console.log(`    Correct series at rank 4–5 : ${inTop5}`);
  console.log(`    NOT found in top 5      : ${absent === 0 ? C.green : C.red}${absent}${C.reset}`);
  if (errs > 0) console.log(`    Search errors           : ${C.red}${errs}${C.reset}`);

  console.log('');
  console.log(`  ${bold('Action Items:')}`);

  if (missingSeries.length > 0)
    console.log(`    ${fail('Some series are missing from Milvus → run insertRecords()')}`);

  if (embeddingData) {
    const zeroCount = embeddingData.filter(r => {
      const v = r.embedding;
      return !Array.isArray(v) || v.length === 0 || v.every(x => x === 0);
    }).length;
    if (zeroCount > 0)
      console.log(`    ${fail(`${zeroCount} records have zero-vector embeddings → run populateEmbeddings()`)}`);
  }

  if (absent > 0)
    console.log(`    ${warn(`${absent} correct series not retrievable — review text_to_embed quality in gs-17.json`)}`);

  if (inTop3 === SAMPLE_DOCS.length && errs === 0)
    console.log(`    ${ok('Vector search is working correctly for all 5 test documents!')}`);

  console.log('');
  console.log(dim('  Diagnostic complete.\n'));
}

main().catch(err => {
  console.error(`\n\x1b[31mFatal error:\x1b[0m ${err.message}`);
  process.exit(1);
});
