/**
 * test_reranking.js — Self-contained regression test for rerankingService.
 *
 * Tests all 17 cases from the implementation plan's test-case matrix, covering
 * every known confusable cluster in GS-17.
 *
 * Run: node backend/scripts/test_reranking.js
 *
 * No external test framework needed — exits 0 on full pass, 1 on any failure.
 */

'use strict';

const path = require('path');

// ── Load helpers ─────────────────────────────────────────────────────────────

// Stub logger so test output stays readable
const logger = {
  info:    (...a) => {},  // silence info during tests
  warn:    (...a) => console.log('[WARN]', ...a),
  error:   (...a) => console.error('[ERROR]', ...a),
  success: (...a) => {},
};

// Patch require before loading the services so they get the stub logger
const Module = require('module');
const _originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../utils/logger' || request.endsWith('/utils/logger')) {
    return logger;
  }
  return _originalLoad.apply(this, arguments);
};

const {
  reRankConfusableClusters,
  computeTermIdfWeights,
  computeWeightedKeywordBoost,
  buildExclusionsGraph,
  detectConfusableClusters,
  NEAR_TIE_EPSILON,
} = require(path.resolve(__dirname, '../services/rerankingService'));

// ── Load GS-17 data ───────────────────────────────────────────────────────────

const gs17Path = path.resolve(__dirname, '../data/schedules/gs-17.json');
let gs17Cache = {};
try {
  const dataset = require(gs17Path);
  (dataset.records || []).forEach((r) => {
    gs17Cache[String(r.series_number).trim()] = r;
  });
  console.log(`Loaded gs-17.json: ${Object.keys(gs17Cache).length} records.\n`);
} catch (e) {
  console.error('Failed to load gs-17.json:', e.message);
  process.exit(1);
}

// ── Test infrastructure ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

/**
 * Build a mock candidate from a series number with a controlled similarity_score.
 */
const mockCandidate = (seriesNumber, similarityScore = 0.820) => {
  const r = gs17Cache[String(seriesNumber).trim()];
  if (!r) throw new Error(`Series ${seriesNumber} not found in gs-17.json`);
  return {
    rank:                  1,  // will be updated by reranker
    series_number:         String(r.series_number).trim(),
    series_title:          r.series_title || '',
    schedule_title:        r.schedule_title || 'GS-17',
    retention_period:      r.retention_period || r.series_retention_period || 'N/A',
    disposition_method:    r.disposition_method || r.series_disposition_method || 'N/A',
    description:           r.series_description || '',
    similarity_score:      similarityScore,
    scope_notes:           r.scope_notes  || null,
    key_criteria:          Array.isArray(r.key_criteria)  ? r.key_criteria  : [],
    exclusions:            Array.isArray(r.exclusions)    ? r.exclusions    : [],
  };
};

/**
 * Assert that after reRankConfusableClusters, a specific series is ranked #1.
 */
const assertTopRank = (label, docText, candidateNumbers, expectedTop, expectCluster) => {
  // Give all candidates the same similarity_score so the boost decides rank order
  const candidates = candidateNumbers.map((num) => mockCandidate(num, 0.820));

  const result = reRankConfusableClusters(docText, candidates);

  const actualTop = String(result[0].series_number).trim();
  const expectedTopStr = String(expectedTop).trim();

  // Cluster check: is expectedTop marked in_confusable_cluster?
  const topEntry = result.find((r) => String(r.series_number).trim() === expectedTopStr);
  const clusterFlagOk = !expectCluster || (topEntry && topEntry.in_confusable_cluster === true);

  const ok = actualTop === expectedTopStr && clusterFlagOk;

  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
    console.log(`        Top: ${actualTop} (expected ${expectedTopStr})`);
    const scores = result.slice(0, 3).map(
      (r) => `${r.series_number}:${(r.reranked_score || r.similarity_score).toFixed(4)}`
    );
    console.log(`        Scores: [${scores.join(', ')}]`);
  } else {
    failed++;
    const reason = actualTop !== expectedTopStr
      ? `Top rank was ${actualTop}, expected ${expectedTopStr}`
      : `in_confusable_cluster flag missing for ${expectedTopStr}`;
    failures.push({ label, reason });
    console.log(`  FAIL  ${label}`);
    console.log(`        Reason: ${reason}`);
    const scores = result.slice(0, 3).map(
      (r) => `${r.series_number}:${(r.reranked_score || r.similarity_score).toFixed(4)}`
    );
    console.log(`        Scores: [${scores.join(', ')}]`);
  }
  console.log('');
};

// ── The 6-way Investigative Case Files cluster ────────────────────────────────
// All six series are present so the cluster detector sees the full connected component.
const INVESTIGATIVE_6WAY = ['100771', '200145', '200146', '200147', '000266', '200148'];

console.log('═══════════════════════════════════════════════════════════');
console.log('  rerankingService — Test Suite (17 cases)');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('── 6-way Investigative Case Files cluster ──────────────────\n');

// T1: Drug possession, case closed — expected 200146 (Less-Serious Resolved)
assertTopRank(
  'T1 — Drug possession resolved → 200146',
  'Drug possession offense. The subject was charged with possession of narcotics. Case closed. Guilty plea entered. Subject was convicted and sentenced. Case resolved and disposed.',
  INVESTIGATIVE_6WAY,
  '200146',
  true
);

// T2: Vandalism, case closed — expected 200146 (Less-Serious Resolved)
assertTopRank(
  'T2 — Vandalism resolved → 200146 [CONFIRMED PRODUCTION FAILURE]',
  'Vandalism incident report. The subject was charged with vandalism and property damage. Case closed. Disposed. Case resolved with conviction.',
  INVESTIGATIVE_6WAY,
  '200146',
  true
);

// T3: Disorderly conduct, closed, non-serious — expected 000266 (Non-Serious Resolved)
assertTopRank(
  'T3 — Disorderly conduct resolved → 000266',
  'Disorderly conduct complaint. Minor offense. Non-serious charge. Case resolved and closed. The subject was a minor offense repeat offender. Misdemeanor case, closed.',
  INVESTIGATIVE_6WAY,
  '000266',
  true
);

// T4: Burglary, active investigation — expected 200147 (Less-Serious Unresolved)
assertTopRank(
  'T4 — Burglary active investigation → 200147',
  'Burglary investigation active. Case active. Open investigation. The subject remains at large. Ongoing investigation into larceny and burglary. Case is unresolved.',
  INVESTIGATIVE_6WAY,
  '200147',
  true
);

// T5: Unsolved homicide, cold case — expected 200145 (Serious Unresolved)
assertTopRank(
  'T5 — Unsolved homicide cold case → 200145',
  'Unsolved homicide investigation. Cold case homicide. Suspect at large. Active homicide investigation, murder open, unresolved. Victim: adult female. No suspects arrested.',
  INVESTIGATIVE_6WAY,
  '200145',
  true
);

// T6: Homicide, resolved, murder conviction — expected 100771 (Serious Resolved)
assertTopRank(
  'T6 — Homicide resolved → 100771',
  'Homicide investigation closed. Murder conviction. The subject was convicted of murder. Serious offense resolved. Aggravated assault case, closed, murder conviction entered. Case resolved.',
  INVESTIGATIVE_6WAY,
  '100771',
  true
);

// ── Missing Persons (100780/100779) ───────────────────────────────────────────
console.log('── Missing Persons cluster (100780 / 100779) ───────────────\n');

// T7: Active missing — expected 100780
assertTopRank(
  'T7 — Person still missing → 100780',
  'Missing person report. Person reported missing. NCIC missing person entry filed. The individual remains missing. Person still missing. Active missing persons case.',
  ['100780', '100779'],
  '100780',
  true
);

// T8: Resolved missing — expected 100779
assertTopRank(
  'T8 — Person found → 100779',
  'Missing person case closure. The missing person was located. Person found safe. Missing person resolved. Runaway located and returned home. Missing person closed.',
  ['100780', '100779'],
  '100779',
  true
);

// ── Traffic Accident (100781/005670) ──────────────────────────────────────────
console.log('── Traffic Accident cluster (100781 / 005670) ──────────────\n');

// T9: Citizen crash — expected 100781
assertTopRank(
  'T9 — Civilian vehicle crash → 100781',
  'Traffic accident report. Civilian vehicle involved. Passenger car crash. Vehicle collision between two citizen vehicles. Driver 1 failed to yield. Civilian crash report.',
  ['100781', '005670'],
  '100781',
  true
);

// T10: Law enforcement vehicle crash — expected 005670
assertTopRank(
  'T10 — Police cruiser crash → 005670',
  'Law enforcement vehicle crash report. Patrol car crash. Officer involved accident. Police cruiser collided with a stationary vehicle. Sheriff vehicle crash. Department vehicle damage sustained.',
  ['100781', '005670'],
  '005670',
  true
);

// ── Red-Light Camera (200151/200152) ──────────────────────────────────────────
console.log('── Red-Light Camera cluster (200151 / 200152) ──────────────\n');

// T11: Not used as evidence — expected 200151
assertTopRank(
  'T11 — Red light, no citation → 200151',
  'Red light camera recording. No summons issued. Traffic light, no citation. COV 15.2-968.1. Traffic signal not summons. The decision was made not to issue a civil penalty. No citation.',
  ['200151', '200152'],
  '200151',
  true
);

// T12: Used as evidence — expected 200152
assertTopRank(
  'T12 — Red light, citation issued → 200152',
  'Red light camera used as evidence. Citation issued. Red light summons issued to motorist. Civil penalty traffic light violation. Used as evidence in court. Court exhibit attached.',
  ['200151', '200152'],
  '200152',
  true
);

// ── Arrest Files (100713/100714/200969) ───────────────────────────────────────
console.log('── Arrest Files cluster (100713 / 100714 / 200969) ─────────\n');

// T13: Adult arrest — expected 100713
assertTopRank(
  'T13 — Adult subject arrest → 100713',
  'Arrest record. Adult subject, age 22. Adult arrest booking sheet completed. Mugshot taken. Fingerprint card submitted to CCRE. Central criminal records exchange notified. Adult offender detained.',
  ['100713', '100714', '200969'],
  '100713',
  true
);

// T14: Juvenile arrest — expected 100714
assertTopRank(
  'T14 — Juvenile offender arrest → 100714',
  'Juvenile arrest record. Juvenile offender taken into custody. Under the age of 18. Juvenile court referral. Delinquency charge filed. Parent or guardian notified. Juvenile detention facility.',
  ['100713', '100714', '200969'],
  '100714',
  true
);

// T15: Pre-1974 historical arrest — expected 200969
assertTopRank(
  'T15 — Pre-1974 historical booking → 200969',
  'Historical arrest record from 1969, prior to 1974. Pre-1974 booking record. Historical fingerprint card. Pre 1974 criminal record. Old arrest record from legacy system.',
  ['100713', '100714', '200969'],
  '200969',
  true
);

// ── Accreditation (200141/100814) ─────────────────────────────────────────────
console.log('── Accreditation cluster (200141 / 100814) ──────────────────\n');

// T16: CALEA — expected 200141
assertTopRank(
  'T16 — CALEA accreditation → 200141',
  'CALEA accreditation compliance documentation. Commission on Accreditation for Law Enforcement Agencies. National accreditation standard. On-site assessment by CALEA assessors. CALEA compliance records.',
  ['200141', '100814'],
  '200141',
  true
);

// T17: VLEPSC — expected 100814
assertTopRank(
  'T17 — VLEPSC accreditation → 100814',
  'VLEPSC accreditation compliance records. Virginia Law Enforcement Professional Standards Commission. Virginia accreditation. State accreditation program. VLEPSC compliance documentation.',
  ['200141', '100814'],
  '100814',
  true
);

// ── Unit tests for sub-functions ──────────────────────────────────────────────
console.log('── Unit tests: sub-functions ────────────────────────────────\n');

// Test computeTermIdfWeights: term unique to one candidate should have weight > shared term
{
  const candA = { key_criteria: ['unique_term_alpha', 'shared_term'] };
  const candB = { key_criteria: ['unique_term_beta',  'shared_term'] };
  const weights = computeTermIdfWeights([candA, candB]);
  const uniqueW = weights.get('unique_term_alpha');
  const sharedW = weights.get('shared_term');
  const ok = uniqueW > sharedW;
  if (ok) {
    passed++;
    console.log(`  PASS  IDF: unique term weight (${uniqueW}) > shared term weight (${sharedW})`);
  } else {
    failed++;
    failures.push({ label: 'IDF weights', reason: `unique ${uniqueW} should > shared ${sharedW}` });
    console.log(`  FAIL  IDF: unique term weight (${uniqueW}) should > shared (${sharedW})`);
  }
  console.log('');
}

// Test GENERIC_STATUS_TERMS cap: 'resolved' should be capped at IDF_GENERIC_TERM_CAP
{
  const candA = { key_criteria: ['resolved', 'unique_x'] };
  const candB = { key_criteria: ['unique_y'] };
  const weights = computeTermIdfWeights([candA, candB]);
  const resolvedW = weights.get('resolved') || 0;
  const ok = resolvedW <= 0.10;
  if (ok) {
    passed++;
    console.log(`  PASS  Generic term cap: 'resolved' weight ${resolvedW} <= 0.10`);
  } else {
    failed++;
    failures.push({ label: 'Generic term cap', reason: `'resolved' weight ${resolvedW} > 0.10` });
    console.log(`  FAIL  Generic term cap: 'resolved' weight ${resolvedW} > 0.10`);
  }
  console.log('');
}

// Test buildExclusionsGraph: mutual edges present
{
  const candA = { series_number: '200146', exclusions: ['000266'] };
  const candB = { series_number: '000266', exclusions: ['200146'] };
  const graph = buildExclusionsGraph([candA, candB]);
  const aNeighbours = graph.get('200146');
  const bNeighbours = graph.get('000266');
  const ok = aNeighbours && aNeighbours.has('000266') && bNeighbours && bNeighbours.has('200146');
  if (ok) {
    passed++;
    console.log(`  PASS  buildExclusionsGraph: mutual edges 200146<->000266 present`);
  } else {
    failed++;
    failures.push({ label: 'buildExclusionsGraph', reason: 'Mutual edges missing' });
    console.log(`  FAIL  buildExclusionsGraph: expected mutual edges 200146<->000266`);
  }
  console.log('');
}

// Test detectConfusableClusters: 6-way cluster is one connected component
{
  const cands = INVESTIGATIVE_6WAY.map((n) => mockCandidate(n, 0.820));
  const graph   = buildExclusionsGraph(cands);
  const clusterMap = detectConfusableClusters(graph);
  const cluster = clusterMap.get('200146');
  // All 6 should be in the same connected component
  const allPresent = INVESTIGATIVE_6WAY.every((n) => cluster && cluster.has(n));
  const ok = allPresent && cluster && cluster.size === 6;
  if (ok) {
    passed++;
    console.log(`  PASS  detectConfusableClusters: 6-way investigative cluster detected correctly`);
  } else {
    failed++;
    failures.push({ label: 'detectConfusableClusters 6-way', reason: `cluster size=${cluster ? cluster.size : 'undefined'}, allPresent=${allPresent}` });
    console.log(`  FAIL  detectConfusableClusters: expected 6-way cluster, got size ${cluster ? cluster.size : 'undefined'}`);
  }
  console.log('');
}

// ── Summary ───────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ' — ALL PASS'}`);
console.log('═══════════════════════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. [${f.label}] ${f.reason}`));
  console.log('');
  process.exit(1);
} else {
  console.log('\nAll tests passed. Re-ranking fix is ready for integration testing.\n');
  process.exit(0);
}
