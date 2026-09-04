// Reranking service: metadata-driven criteria scoring and confusable cluster boost
'use strict';

const logger = require('../utils/logger');

// Boost ceiling for candidates outside a detected cluster
const STANDARD_MAX_BOOST = 0.060;

// Amplified boost ceiling for candidates in a confusable cluster
const CLUSTER_MAX_BOOST = 0.120;

// Minimum mutually-excluded candidates required to activate cluster mode
const CLUSTER_SIZE_THRESHOLD = 2;

// Score delta threshold below which an LLM disambiguation banner is triggered
const NEAR_TIE_EPSILON = 0.005;

// Maximum IDF weight assigned to non-discriminating generic status words
const IDF_GENERIC_TERM_CAP = 0.10;

// Generic terms that appear across multiple series descriptions and lack discriminating signal
const GENERIC_STATUS_TERMS = new Set([
  'resolved', 'unresolved', 'closed', 'open', 'active', 'ongoing',
  'case', 'investigation', 'criminal', 'offense', 'record', 'file',
  'law enforcement', 'police', 'department',
  'case resolved', 'case closed', 'case active', 'case open',
  'non-serious', 'less serious', 'serious',
]);

// Compute normalized 0.0–1.0 IDF weights for criteria terms across candidates
const computeTermIdfWeights = (candidates) => {
  const termDf = new Map();

  for (const cand of candidates) {
    const criteria = Array.isArray(cand.key_criteria) ? cand.key_criteria : [];
    const seen = new Set();
    for (const term of criteria) {
      const lower = term.toLowerCase().trim();
      if (!lower || seen.has(lower)) continue;
      seen.add(lower);
      termDf.set(lower, (termDf.get(lower) || 0) + 1);
    }
  }

  if (termDf.size === 0) return new Map();

  const rawWeights = new Map();
  let maxRaw = 0;
  for (const [term, df] of termDf) {
    const raw = 1 / df;
    rawWeights.set(term, raw);
    if (raw > maxRaw) maxRaw = raw;
  }

  const termWeightMap = new Map();
  for (const [term, raw] of rawWeights) {
    let normalized = maxRaw > 0 ? raw / maxRaw : 0;
    if (GENERIC_STATUS_TERMS.has(term)) {
      normalized = Math.min(normalized, IDF_GENERIC_TERM_CAP);
    }
    termWeightMap.set(term, Math.round(normalized * 10000) / 10000);
  }

  return termWeightMap;
};

// Match terms using word boundaries and singular/plural inflections
const matchCriteriaTerm = (text, term) => {
  const trimmed = term.trim();
  if (!trimmed) return false;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Exact phrase match bounded by start/end or non-alphanumeric characters
  const exact = new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])', 'i');
  if (exact.test(text)) return true;

  // Handle common plural and singular inflections
  if (trimmed.endsWith('ies') && trimmed.length > 4) {
    const singular = trimmed.slice(0, -3) + 'y';
    if (new RegExp('(^|[^a-z0-9])' + singular + '($|[^a-z0-9])', 'i').test(text)) return true;
  } else if (trimmed.endsWith('y') && trimmed.length > 3) {
    const plural = trimmed.slice(0, -1) + 'ies';
    if (new RegExp('(^|[^a-z0-9])' + plural + '($|[^a-z0-9])', 'i').test(text)) return true;
  } else if (trimmed.endsWith('s') && !trimmed.endsWith('ss') && trimmed.length > 3) {
    const singular = trimmed.slice(0, -1);
    if (new RegExp('(^|[^a-z0-9])' + singular + '($|[^a-z0-9])', 'i').test(text)) return true;
  } else if (!trimmed.endsWith('s') && trimmed.length > 2) {
    const plural = trimmed + 's';
    if (new RegExp('(^|[^a-z0-9])' + plural + '($|[^a-z0-9])', 'i').test(text)) return true;
  }

  return false;
};

// Calculate keyword boost using sub-linear saturation on matched discriminating weight
const computeWeightedKeywordBoost = (candidate, cleanedText, termWeightMap, opts = {}) => {
  const maxBoost = typeof opts.maxBoost === 'number' ? opts.maxBoost : STANDARD_MAX_BOOST;
  const criteria = Array.isArray(candidate.key_criteria) ? candidate.key_criteria : [];

  if (criteria.length === 0) {
    return { boost: 0, matchedTerms: [], totalCandidateWeight: 0, matchedWeight: 0 };
  }

  const text = typeof cleanedText === 'string' ? cleanedText.toLowerCase() : '';
  let matchedWeight = 0;
  let totalCandidateWeight = 0;
  const matchedTerms = [];

  for (const term of criteria) {
    const lower = term.toLowerCase().trim();
    if (!lower) continue;
    const weight = termWeightMap.get(lower) || 0;
    totalCandidateWeight += weight;
    if (matchCriteriaTerm(text, lower)) {
      matchedWeight += weight;
      matchedTerms.push(term);
    }
  }

  // Sub-linear saturation prevents penalizing broad series with large offense catalogs
  const saturationRatio = matchedWeight > 0 ? (matchedWeight / (matchedWeight + 0.8)) : 0;
  const boost = Math.round(Math.min(maxBoost, saturationRatio * maxBoost) * 10000) / 10000;

  return { boost, matchedTerms, totalCandidateWeight, matchedWeight };
};

// Build adjacency graph of mutual exclusions among active candidates
const buildExclusionsGraph = (candidates) => {
  const candidateSet = new Set(candidates.map((c) => String(c.series_number).trim()));
  const graph = new Map();

  for (const num of candidateSet) {
    graph.set(num, new Set());
  }

  for (const cand of candidates) {
    const a = String(cand.series_number).trim();
    const exclusions = Array.isArray(cand.exclusions) ? cand.exclusions : [];
    for (const b of exclusions) {
      const bStr = String(b).trim();
      if (candidateSet.has(bStr) && bStr !== a) {
        graph.get(a).add(bStr);
        if (graph.has(bStr)) {
          graph.get(bStr).add(a);
        }
      }
    }
  }

  return graph;
};

// Identify connected confusable clusters in the exclusions graph via BFS
const detectConfusableClusters = (exclusionsGraph) => {
  const visited = new Set();
  const seriesNumberToCluster = new Map();

  for (const [start] of exclusionsGraph) {
    if (visited.has(start)) continue;

    const cluster = new Set();
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift();
      if (visited.has(node)) continue;
      visited.add(node);
      cluster.add(node);
      const neighbours = exclusionsGraph.get(node) || new Set();
      for (const neighbour of neighbours) {
        if (!visited.has(neighbour)) {
          queue.push(neighbour);
        }
      }
    }

    for (const member of cluster) {
      seriesNumberToCluster.set(member, cluster);
    }
  }

  return seriesNumberToCluster;
};

// Re-rank candidates by applying IDF keyword boost with amplified ceiling for confusable clusters
const reRankConfusableClusters = (cleanedText, candidates, opts = {}) => {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return candidates;
  }

  const standardMaxBoost     = typeof opts.standardMaxBoost     === 'number' ? opts.standardMaxBoost     : STANDARD_MAX_BOOST;
  const clusterMaxBoost      = typeof opts.clusterMaxBoost      === 'number' ? opts.clusterMaxBoost      : CLUSTER_MAX_BOOST;
  const clusterSizeThreshold = typeof opts.clusterSizeThreshold === 'number' ? opts.clusterSizeThreshold : CLUSTER_SIZE_THRESHOLD;

  const termWeightMap = computeTermIdfWeights(candidates);
  const exclusionsGraph = buildExclusionsGraph(candidates);
  const seriesNumberToCluster = detectConfusableClusters(exclusionsGraph);

  // Log active confusable clusters
  const loggedClusters = new Set();
  for (const [, cluster] of seriesNumberToCluster) {
    if (cluster.size >= clusterSizeThreshold) {
      const key = [...cluster].sort().join(',');
      if (!loggedClusters.has(key)) {
        loggedClusters.add(key);
        logger.info(
          `[rerankingService] Confusable cluster detected (${cluster.size}): ` +
          `[${[...cluster].join(', ')}] — applying amplified ceiling ${clusterMaxBoost}`
        );
      }
    }
  }

  // Calculate score boost for each candidate
  const scored = candidates.map((cand) => {
    const seriesNum = String(cand.series_number).trim();
    const cluster   = seriesNumberToCluster.get(seriesNum) || new Set([seriesNum]);
    const inCluster = cluster.size >= clusterSizeThreshold;
    const maxBoost  = inCluster ? clusterMaxBoost : standardMaxBoost;

    const { boost, matchedTerms, totalCandidateWeight, matchedWeight } =
      computeWeightedKeywordBoost(cand, cleanedText, termWeightMap, { maxBoost });

    const rerankedScore = Math.round((cand.similarity_score + boost) * 10000) / 10000;

    if (boost > 0) {
      logger.info(
        `[rerankingService] Series ${seriesNum} "${cand.series_title}": ` +
        `boost +${boost.toFixed(4)} (raw=${cand.similarity_score.toFixed(4)} -> reranked=${rerankedScore.toFixed(4)}) ` +
        `[cluster=${inCluster}, matched ${matchedTerms.length} terms: ` +
        `${matchedTerms.slice(0, 5).join(', ')}${matchedTerms.length > 5 ? ', ...' : ''}]`
      );
    }

    return {
      ...cand,
      reranked_score:        rerankedScore,
      in_confusable_cluster: inCluster,
      _rerank_boost:         boost,
      _rerank_matched_terms: matchedTerms,
    };
  });

  // Sort descending by reranked score, breaking ties with raw similarity
  scored.sort((a, b) => {
    if (b.reranked_score !== a.reranked_score) {
      return b.reranked_score - a.reranked_score;
    }
    return b.similarity_score - a.similarity_score;
  });

  // Log rank updates and clean internal tracking properties
  const result = scored.map((cand, newIdx) => {
    const origIdx = candidates.findIndex(
      (c) => String(c.series_number).trim() === String(cand.series_number).trim()
    );

    if (origIdx !== -1 && origIdx !== newIdx) {
      logger.info(
        `[rerankingService] Rank change: Series ${cand.series_number} ` +
        `${origIdx + 1} -> ${newIdx + 1} (raw: ${cand.similarity_score.toFixed(4)}, ` +
        `reranked: ${cand.reranked_score.toFixed(4)}, boost: +${cand._rerank_boost.toFixed(4)})`
      );
    }

    const copy = { ...cand };
    delete copy._rerank_boost;
    delete copy._rerank_matched_terms;
    return { ...copy, rank: newIdx + 1 };
  });

  // Warn when top candidates remain within near-tie epsilon
  if (
    result.length >= 2 &&
    Math.abs(result[0].reranked_score - result[1].reranked_score) < NEAR_TIE_EPSILON
  ) {
    logger.warn(
      `[rerankingService] Near-tie: Series ${result[0].series_number} (${result[0].reranked_score.toFixed(4)}) vs ` +
      `Series ${result[1].series_number} (${result[1].reranked_score.toFixed(4)}) — ` +
      `delta=${Math.abs(result[0].reranked_score - result[1].reranked_score).toFixed(4)} < ${NEAR_TIE_EPSILON}`
    );
  }

  return result;
};

module.exports = {
  reRankConfusableClusters,
  computeTermIdfWeights,
  computeWeightedKeywordBoost,
  buildExclusionsGraph,
  detectConfusableClusters,
  NEAR_TIE_EPSILON,
  STANDARD_MAX_BOOST,
  CLUSTER_MAX_BOOST,
  CLUSTER_SIZE_THRESHOLD,
  GENERIC_STATUS_TERMS,
  IDF_GENERIC_TERM_CAP,
};
