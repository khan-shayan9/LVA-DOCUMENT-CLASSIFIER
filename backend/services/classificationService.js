// RAG classification service using Cloudflare Workers AI (Llama 3.1 8B)
const config = require('../config/app.config');
const logger = require('../utils/logger');
const { NEAR_TIE_EPSILON } = require('./rerankingService');

const CLASSIFICATION_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const CF_AI_URL = (accountId, model) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

// Validate required environment variables
if (!config.cloudflare.accountId) {
  throw new Error('[classificationService] CLOUDFLARE_ACCOUNT_ID is not set in environment.');
}

if (!config.cloudflare.apiToken) {
  throw new Error('[classificationService] CLOUDFLARE_API_TOKEN is not set in environment.');
}

// Confidence indicator keywords for reasoning analysis
const CONFIDENCE_KEYWORDS = {
  HIGH: [
    'exactly', 'perfect', 'clearly', 'matches', 'definitely',
    'precisely', 'unambiguously', 'direct match', 'best match',
    'perfectly', 'exact match', 'clearly matches'
  ],
  MEDIUM: [
    'aligns', 'fits', 'good', 'reasonable', 'appropriate',
    'consistent', 'appears', 'seems', 'suitable', 'related'
  ],
  LOW: [
    'could', 'might', 'possibly', 'similar', 'suggests',
    'indicates', 'may', 'unclear', 'ambiguous'
  ],
};

// Scan AI reasoning text for confidence level
const detectAIConfidenceLevel = (aiReasoning, explicitCertainty = null) => {
  try {
    // 1. Check explicit certainty field if provided by LLM
    if (typeof explicitCertainty === 'string' && explicitCertainty.trim()) {
      const norm = explicitCertainty.trim().toUpperCase();
      if (norm === 'HIGH' || norm === 'MEDIUM' || norm === 'LOW') {
        return norm;
      }
    }

    // 2. Fallback to keyword scanning in reasoning text
    if (typeof aiReasoning !== 'string' || !aiReasoning.trim()) {
      return 'MEDIUM';
    }

    const text = aiReasoning.toLowerCase();

    for (const kw of CONFIDENCE_KEYWORDS.HIGH) {
      if (text.includes(kw)) return 'HIGH';
    }

    for (const kw of CONFIDENCE_KEYWORDS.MEDIUM) {
      if (text.includes(kw)) return 'MEDIUM';
    }

    for (const kw of CONFIDENCE_KEYWORDS.LOW) {
      if (text.includes(kw)) return 'LOW';
    }

    return 'MEDIUM';
  } catch (err) {
    logger.warn(`detectAIConfidenceLevel failed: ${err.message}. Using default 'MEDIUM'.`);
    return 'MEDIUM';
  }
};

// Calculate confidence boost for high-confidence AI reasoning
const calculateBoost = (aiConfidence, similarityScore) => {
  try {
    if (aiConfidence !== 'HIGH') return 0.0;
    if (typeof similarityScore !== 'number' || isNaN(similarityScore) || similarityScore < 0.65) {
      return 0.0;
    }

    const rawBoost = 0.08 + Math.min(0.04, Math.max(0, (similarityScore - 0.65) * 0.2));
    return Math.round(rawBoost * 10000) / 10000;
  } catch (err) {
    logger.warn(`calculateBoost failed: ${err.message}. Returning 0.0 boost.`);
    return 0.0;
  }
};

// Calculate final confidence capped at 0.95 and ensure non-penalizing
const calculateFinalConfidence = (similarityScore, aiReasoning, explicitCertainty = null) => {
  const baseSimilarity = (typeof similarityScore === 'number' && !isNaN(similarityScore))
    ? Math.round(similarityScore * 10000) / 10000
    : 0;

  const aiConfidenceLevel = detectAIConfidenceLevel(aiReasoning, explicitCertainty);
  const boostApplied = calculateBoost(aiConfidenceLevel, baseSimilarity);
  const rawFinal = baseSimilarity + boostApplied;
  const finalConfidence = Math.min(0.95, Math.max(baseSimilarity, Math.round(rawFinal * 10000) / 10000));

  return {
    finalConfidence,
    components: {
      base_similarity_score: baseSimilarity,
      ai_confidence_level: aiConfidenceLevel,
      confidence_boost_applied: boostApplied,
      final_confidence: finalConfidence,
    },
  };
};

// Parse JSON output from LLM, stripping markdown block wrappers
const parseAIJSONResponse = (rawContent) => {
  if (typeof rawContent === 'object' && rawContent !== null) {
    return rawContent;
  }

  if (typeof rawContent !== 'string') {
    throw new Error('Raw content is neither object nor string');
  }

  let text = rawContent.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx !== -1 && endIdx > startIdx) {
    text = text.substring(startIdx, endIdx + 1);
  }

  return JSON.parse(text);
};

const { createDocumentContextWindow } = require('./textCleaningService');

const MAX_LLM_CONTEXT_CHARS = 4000;

// Evaluates document text against candidates using RAG prompting
const classifyDocument = async (cleanedText, topCandidates) => {
  if (typeof cleanedText !== 'string' || cleanedText.trim().length === 0) {
    throw new Error('[classificationService] Document cleanedText must be a non-empty string.');
  }

  if (!Array.isArray(topCandidates) || topCandidates.length === 0) {
    throw new Error('[classificationService] topCandidates must be a non-empty array.');
  }

  const promptDocumentText = createDocumentContextWindow(cleanedText, {
    maxLength: MAX_LLM_CONTEXT_CHARS,
    headRatio: 0.375,
    middleRatio: 0.25,
    tailRatio: 0.375,
  });

  if (promptDocumentText.length !== cleanedText.length) {
    logger.info(
      `Long document context window applied: ${cleanedText.length} -> ${promptDocumentText.length} chars (Head + Middle + Tail).`
    );
  }

  logger.info(`Building RAG classification prompt for document (${promptDocumentText.length} chars) with ${topCandidates.length} candidates...`);

  // Format candidate descriptions for prompt — dynamically inject scope_notes/key_criteria/exclusions
  const candidateListFormatted = topCandidates.map((cand, idx) => {
    const num   = cand.series_number || 'Unknown';
    const title = cand.series_title  || 'Unknown Title';
    const ret   = cand.retention_period || cand.series_retention_period || 'N/A';
    const disp  = cand.disposition_method || cand.series_disposition_method || 'N/A';
    const score = typeof cand.similarity_score === 'number' ? cand.similarity_score.toFixed(4) : 'N/A';

    // Metadata-driven disambiguation fields (populated from gs-17.json enrichment)
    const scopeNotes   = cand.scope_notes   || null;
    const keyCriteria  = Array.isArray(cand.key_criteria)  && cand.key_criteria.length  > 0 ? cand.key_criteria  : null;
    const exclusions   = Array.isArray(cand.exclusions)    && cand.exclusions.length    > 0 ? cand.exclusions    : null;

    let entry = `${idx + 1}. Series [${num}]: "${title}"
   - Schedule: "${cand.schedule_title || 'GS-17'}"
   - Retention Period: "${ret}"
   - Disposition Method: "${disp}"
   - Similarity Score: ${score}`;

    if (scopeNotes)  entry += `\n   - Scope Notes: "${scopeNotes}"`;
    if (keyCriteria) entry += `\n   - Key Criteria: ["${keyCriteria.join('", "')}"]`;
    if (exclusions)  entry += `\n   - Must NOT Confuse With Series: [${exclusions.join(', ')}]`;

    return entry;
  }).join('\n\n');

  const validSeriesNumbers = topCandidates.map(c => String(c.series_number).trim()).join(', ');

  // Generic schedule-agnostic system prompt — all disambiguation knowledge is now in the
  // candidate metadata (scope_notes, key_criteria, exclusions) injected into the user prompt above.
  const systemPrompt = `You are an expert government records management specialist.

Your task: analyze the provided document and select the SINGLE best matching record series from the candidate list.

Reasoning method:
1. Extract the key factual characteristics of the document (subject identity/age, incident type, offense severity, evidence status, case resolution outcome).
2. Compare those explicit facts against the Scope Notes and Key Criteria provided for each candidate.
3. Pay close attention to the "Must NOT Confuse With Series" exclusions listed for each candidate.
4. Select the candidate whose Scope Notes best match the document facts. Candidate #1 is the strongest retrieval prior, but override it if document facts clearly align with a lower-ranked candidate's scope notes.
5. Base your reasoning ONLY on explicit facts present in the document — never extrapolate or hallucinate.

STRICT RULE: Your selected series MUST be from this list: [${validSeriesNumbers}].`;

  // Inject disambiguation banner if top candidates are within near-tie epsilon
  let nearTieBanner = '';
  if (topCandidates.length >= 2) {
    const score0 = typeof topCandidates[0].reranked_score === 'number'
      ? topCandidates[0].reranked_score
      : topCandidates[0].similarity_score;
    const score1 = typeof topCandidates[1].reranked_score === 'number'
      ? topCandidates[1].reranked_score
      : topCandidates[1].similarity_score;
    if (Math.abs(score0 - score1) < NEAR_TIE_EPSILON) {
      nearTieBanner =
        `\n\n⚠️  DISAMBIGUATION REQUIRED: The top 2 candidates have near-identical ` +
        `similarity scores (delta=${Math.abs(score0 - score1).toFixed(4)}). ` +
        `Candidate #1 is NOT automatically correct. ` +
        `You MUST compare the document facts against every candidate's "Key Criteria" ` +
        `and "Must NOT Confuse With Series" fields to determine the correct series. ` +
        `Do NOT rely on rank order alone.`;
      logger.warn(
        `[classificationService] Near-tie banner injected: ` +
        `Series ${topCandidates[0].series_number} (${score0.toFixed(4)}) vs ` +
        `Series ${topCandidates[1].series_number} (${score1.toFixed(4)})`
      );
    }
  }

  const userPrompt = `Document Content:
"""
${promptDocumentText}
"""

Candidate Record Series (ranked by semantic similarity & legal signals):
${candidateListFormatted}${nearTieBanner}

Instructions:
1. Identify the key facts in the document (subject age/status, offense/record type, evidence status, case resolution).
2. Compare the document facts directly against the Candidate Record Series descriptions above.
3. Select the SINGLE series number from the candidate list that best matches the document.
4. Explain your decision in 1-2 concise sentences linking explicit facts in the Document Content directly to the chosen record series.
5. Provide your certainty level ("HIGH", "MEDIUM", or "LOW").

You MUST respond ONLY with a JSON object in the following format:
{
  "key_facts_identified": ["<key fact 1>", "<key fact 2>"],
  "selected_series_number": "<series_number>",
  "reasoning": "<1-2 sentence explanation linking facts to series>",
  "certainty": "HIGH" | "MEDIUM" | "LOW"
}
Do not include any text outside the JSON object.`;

  // Call Cloudflare Workers AI API
  const url = CF_AI_URL(config.cloudflare.accountId, CLASSIFICATION_MODEL);
  logger.info(`Sending RAG classification request to Workers AI (${CLASSIFICATION_MODEL})...`);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.cloudflare.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });
  } catch (networkErr) {
    throw new Error(`Network error calling Cloudflare Workers AI: ${networkErr.message}`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '(unreadable)');
    throw new Error(`Cloudflare Workers AI returned HTTP ${response.status}: ${errText}`);
  }

  let responseJson;
  try {
    responseJson = await response.json();
  } catch (jsonErr) {
    throw new Error(`Failed to parse response JSON from Cloudflare Workers AI: ${jsonErr.message}`);
  }

  if (!responseJson.success || !responseJson.result) {
    throw new Error(`Cloudflare Workers AI API error: ${JSON.stringify(responseJson.errors || responseJson)}`);
  }

  // Extract raw output
  const resultObj = responseJson.result;
  let rawOutput = null;

  if (resultObj.response) {
    rawOutput = resultObj.response;
  } else if (resultObj.choices && resultObj.choices[0] && resultObj.choices[0].message) {
    rawOutput = resultObj.choices[0].message.content;
  } else {
    throw new Error('Unexpected response format from Cloudflare Workers AI LLM.');
  }

  // Parse AI output
  let parsed;
  try {
    parsed = parseAIJSONResponse(rawOutput);
  } catch (parseErr) {
    logger.error('Failed to parse AI classification output JSON.', parseErr);
    throw new Error(`AI returned invalid JSON: ${typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput)}`);
  }

  let selectedSeries = parsed.selected_series_number || parsed.selected_series || null;
  const reasoning = parsed.reasoning || parsed.ai_reasoning || null;
  const explicitCertainty = parsed.certainty || null;

  if (!selectedSeries) {
    throw new Error('AI output missing "selected_series_number" field.');
  }

  if (!reasoning) {
    throw new Error('AI output missing "reasoning" field.');
  }

  // Fallback to top candidate if AI picks non-candidate series
  let matchingCandidate = topCandidates.find(
    (c) => String(c.series_number).trim() === String(selectedSeries).trim()
  );

  if (!matchingCandidate) {
    logger.warn(
      `AI returned series number "${selectedSeries}" which is not in the provided candidates list ` +
      `[${validSeriesNumbers}]. Falling back to top candidate "${topCandidates[0].series_number}".`
    );
    matchingCandidate = topCandidates[0];
    selectedSeries = topCandidates[0].series_number;
  }

  let baseSimilarity = 0;
  if (matchingCandidate && typeof matchingCandidate.similarity_score === 'number') {
    baseSimilarity = matchingCandidate.similarity_score;
  } else if (topCandidates[0] && typeof topCandidates[0].similarity_score === 'number') {
    baseSimilarity = topCandidates[0].similarity_score;
  }

  const { finalConfidence, components } = calculateFinalConfidence(baseSimilarity, reasoning, explicitCertainty);

  logger.success(
    `Classification complete: Selected Series ${selectedSeries} ` +
    `(Base Sim: ${baseSimilarity.toFixed(4)}, AI Conf: ${components.ai_confidence_level}, ` +
    `Boost: +${components.confidence_boost_applied}, Final Conf: ${finalConfidence})`
  );

  return {
    selected_series_number: String(selectedSeries).trim(),
    ai_reasoning:           String(reasoning).trim(),
    confidence:             finalConfidence,
    confidence_components:  components,
  };
};

module.exports = {
  classifyDocument,
  detectAIConfidenceLevel,
  calculateBoost,
  calculateFinalConfidence,
};

