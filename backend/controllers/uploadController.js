// Upload request controller - orchestrates upload, extraction, search, and classification
const MIN_SIMILARITY_THRESHOLD = 0.65;
const SEARCH_CANDIDATE_LIMIT = 8;
const CLASSIFICATION_CANDIDATE_LIMIT = 5;

const uploadService = require('../services/uploadService');
const extractionService = require('../services/extractionService');
const textCleaningService = require('../services/textCleaningService');
const { searchSimilarRecords, getFullRecord } = require('../services/milvusService');
const classificationService = require('../services/classificationService');
const { reRankConfusableClusters } = require('../services/rerankingService');
const config = require('../config/app.config');
const logger = require('../utils/logger');

const path    = require('path');
const toLower = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

const SCHEDULES_DIR = path.resolve(__dirname, '../data/schedules');

// Load and merge key_criteria + scope_notes + exclusions from all schedule files in data/schedules/
const loadMetadataCache = () => {
  const cache = {};
  try {
    const files = require('fs').readdirSync(SCHEDULES_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const records = JSON.parse(require('fs').readFileSync(path.resolve(SCHEDULES_DIR, f), 'utf8')).records || [];
      for (const r of records) cache[String(r.series_number).trim()] = r;
    }
    logger.info(`Metadata cache loaded: ${Object.keys(cache).length} series from ${files.length} schedule file(s).`);
  } catch (e) {
    logger.warn(`Failed to load schedule metadata: ${e.message}`);
  }
  return cache;
};

// Metadata cache populated at startup — covers all loaded schedule files
const metadataCache = loadMetadataCache();

const getGs17Record = (seriesNumber) => {
  return metadataCache[String(seriesNumber).trim()] || null;
};

// ── Generic Metadata-Driven Keyword Boost ──────────────────────────────────
//
// Replaces the previous 550-line GS-17-specific heuristic engine.
// Reads key_criteria from the candidate object (populated from schedule files)
// and scores how many of those criteria appear in the document text.
// This makes the reranker fully schedule-agnostic — no schedule-specific
// regex patterns needed in code.

/**
 * Compute a boost score for a single candidate based on its key_criteria
 * matching against the lowercased document text.
 *
 * @param {object} candidate  - The candidate object (must have .key_criteria array)
 * @param {string} cleanedText - The full extracted document text
 * @returns {{ boost: number, reasons: string[] }}
 */
const computeGenericKeywordBoost = (candidate, cleanedText) => {
  const keyCriteria = Array.isArray(candidate.key_criteria) ? candidate.key_criteria : [];
  if (keyCriteria.length === 0) return { boost: 0, reasons: [] };

  const text    = toLower(cleanedText);
  const matched = keyCriteria.filter(kw => text.includes(toLower(kw)));
  const ratio   = matched.length / keyCriteria.length;

  // Max boost of 0.030, proportional to keyword hit ratio.
  // At 100% match = +0.030; at 50% match = +0.015; at 0% = 0.
  const boost   = Math.round(Math.min(0.030, ratio * 0.030) * 10000) / 10000;
  const reasons = matched.length > 0
    ? [`Keyword match ${matched.length}/${keyCriteria.length}: [${matched.slice(0, 4).join(', ')}${matched.length > 4 ? ', ...' : ''}]`]
    : [];

  return { boost, reasons };
};

// Rerank candidates adaptively using generic metadata-driven keyword scoring.
// Each candidate's key_criteria array (populated from gs-17.json) is matched
// against the document text. No schedule-specific patterns needed in code.
const rerankEdgeCandidates = (cleanedText, candidates) => {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return candidates;
  }

  const scoredCandidates = candidates.map((candidate) => {
    const { boost, reasons } = computeGenericKeywordBoost(candidate, cleanedText);
    const adjustedScore = candidate.similarity_score + boost;

    if (boost > 0) {
      logger.info(
        `Keyword boost for Series ${candidate.series_number} "${candidate.series_title}": ` +
        `+${boost.toFixed(4)} (raw=${candidate.similarity_score.toFixed(4)} -> adjusted=${adjustedScore.toFixed(4)}) ` +
        `[${reasons.join('; ')}]`
      );
    }

    return {
      ...candidate,
      _signal_boost: boost,
      _signal_reasons: reasons,
      _adjusted_score: adjustedScore,
    };
  });

  // Sort by adjusted score descending, tie-break by raw similarity_score
  scoredCandidates.sort((a, b) => {
    if (b._adjusted_score !== a._adjusted_score) {
      return b._adjusted_score - a._adjusted_score;
    }
    return b.similarity_score - a.similarity_score;
  });

  // Log rank changes
  scoredCandidates.forEach((cand, newIdx) => {
    const origIdx = candidates.findIndex((c) => String(c.series_number).trim() === String(cand.series_number).trim());
    if (origIdx !== -1 && origIdx !== newIdx) {
      logger.info(
        `Adaptive rerank: Series ${cand.series_number} shifted rank ${origIdx + 1} -> ${newIdx + 1} ` +
        `(raw: ${cand.similarity_score.toFixed(4)}, boost: +${cand._signal_boost.toFixed(4)})`
      );
    }
  });

  // Remove internal tracking fields and update rank
  return scoredCandidates.map((candidate, index) => {
    const copy = { ...candidate };
    delete copy._signal_boost;
    delete copy._signal_reasons;
    delete copy._adjusted_score;
    return { ...copy, rank: index + 1 };
  });
};

// Handles POST /api/v1/upload
const handleUpload = async (req, res, next) => {
  try {
    // Validate uploaded file presence
    if (req.fileValidationError) {
      logger.warn(`Upload rejected: ${req.fileValidationError}`);
      return res.status(400).json({
        success: false,
        message: req.fileValidationError,
      });
    }

    if (!req.file) {
      logger.warn('Upload rejected: no file was attached to the request.');
      return res.status(400).json({
        success: false,
        message: 'No file was uploaded. Please attach a PDF, DOCX, or Excel file.',
      });
    }

    // Step 1 + 2: Archive to Cloudflare R2 and extract text from the buffer
    // Multer already has in memory — run concurrently instead of extracting
    // from a second, redundant R2 download after the upload completes.
    // Extraction failures are caught internally (never reject) so they stay
    // a soft failure, same as before; an R2 upload failure still rejects and
    // fails the whole request, also same as before.
    const extractAndClean = async () => {
      try {
        const extracted = await extractionService.extractUploadedFile(req.file.buffer, req.file.originalname);

        if (extracted && typeof extracted.text === 'string') {
          const cleanedExtraction = textCleaningService.cleanExtractedText(extracted.text, {
            r2Key: req.file.originalname,
            fileType: extracted.fileType,
            source: 'upload-preview',
          });

          return {
            fileType: extracted.fileType,
            text: cleanedExtraction.text,
            error: null,
          };
        }

        return { fileType: extracted ? extracted.fileType : null, text: null, error: null };
      } catch (extractErr) {
        logger.warn(`Document Extraction failed for "${req.file.originalname}": ${extractErr.message}\n`);
        return {
          fileType: null,
          text: null,
          error: extractErr.message,
        };
      }
    };

    const [uploadedDocument, extraction] = await Promise.all([
      uploadService.processUpload(req.file),
      extractAndClean(),
    ]);

    // Step 3: Vector search candidate retrieval in Milvus
    let allCandidates = null;
    let top3Candidates = null;
    let classificationCandidates = null;
    let searchWarning = null;

    if (extraction && extraction.text) {
      try {
        logger.info(`Running Milvus similarity search for "${uploadedDocument.r2Key}"...`);

        const rawCandidates = await searchSimilarRecords(extraction.text, SEARCH_CANDIDATE_LIMIT);

        allCandidates = rawCandidates.map((candidate, index) => {
          // Enrich each candidate with scope_notes, key_criteria, exclusions from local gs-17.json
          const localRecord = getGs17Record(candidate.series_number);
          return {
            rank:                index + 1,
            series_number:       candidate.series_number,
            schedule_number:     candidate.schedule_number,
            schedule_title:      candidate.schedule_title,
            series_title:        candidate.series_title,
            retention_period:    candidate.series_retention_period,
            disposition_method:  candidate.series_disposition_method,
            description:         candidate.series_description,
            similarity_score:    candidate.similarity_score,
            // Phase 1 metadata fields — read from local JSON (Option B, no Milvus schema change)
            scope_notes:         localRecord ? (localRecord.scope_notes  || null) : null,
            key_criteria:        localRecord ? (localRecord.key_criteria || [])   : [],
            exclusions:          localRecord ? (localRecord.exclusions   || [])   : [],
          };
        });

        allCandidates = rerankEdgeCandidates(extraction.text, allCandidates);

        // Re-rank candidates using metadata-driven IDF criteria scoring & cluster amplification
        allCandidates = reRankConfusableClusters(extraction.text, allCandidates);

        top3Candidates = allCandidates.slice(0, 3);
        classificationCandidates = allCandidates.slice(0, CLASSIFICATION_CANDIDATE_LIMIT);

        logger.success(
          `Search complete for "${uploadedDocument.r2Key}". Retrieved ${allCandidates.length} candidates. ` +
          `Top match: series ${top3Candidates[0].series_number} ` +
          `(score=${top3Candidates[0].similarity_score.toFixed(4)})`
        );
      } catch (searchErr) {
        logger.warn(
          `Milvus search failed for "${uploadedDocument.r2Key}": ${searchErr.message}`
        );
        allCandidates = null;
        top3Candidates = null;
        classificationCandidates = null;
        searchWarning = `Similarity search failed: ${searchErr.message}`;
      }
    } else {
      logger.info(
        `Skipping search for "${uploadedDocument.r2Key}": no cleaned text available.`
      );
    }

    // Step 4: Similarity threshold check & LLM classification
    let classification = null;
    let classificationWarning = null;
    let outOfScope = false;

    if (extraction && extraction.text && top3Candidates && top3Candidates.length > 0) {
      const topScore = top3Candidates[0].similarity_score;

      // Flag out-of-scope documents if below similarity threshold
      if (topScore < MIN_SIMILARITY_THRESHOLD) {
        outOfScope = true;
        logger.warn(
          `Low-confidence result for "${uploadedDocument.r2Key}": ` +
          `top candidate score ${topScore.toFixed(4)} is below threshold ${MIN_SIMILARITY_THRESHOLD}. ` +
          `Skipping LLM classification — document may not belong to GS-17.`
        );
      } else {
        try {
          const ragCandidates = (classificationCandidates && classificationCandidates.length > 0)
            ? classificationCandidates
            : top3Candidates;

          logger.info(`Running RAG classification for "${uploadedDocument.r2Key}" using ${ragCandidates.length} candidates...`);

          const classResult = await classificationService.classifyDocument(
            extraction.text,
            ragCandidates
          );

          classification = {
            selected_series_number: classResult.selected_series_number,
            ai_reasoning: classResult.ai_reasoning,
            confidence: classResult.confidence,
          };

          logger.success(
            `Classification complete for "${uploadedDocument.r2Key}". ` +
            `Selected: series ${classification.selected_series_number}`
          );
        } catch (classErr) {
          logger.error(`RAG Classification failed for "${uploadedDocument.r2Key}"`, classErr);
          classification = null;
          classificationWarning = `RAG Classification failed: ${classErr.message}`;
        }
      }
    } else if (top3Candidates === null && extraction && extraction.text) {
      classificationWarning = 'RAG Classification skipped because vector search did not return candidates.';
    }

    // Step 5: Resolve full metadata for the selected series. classifyDocument()
    // only ever picks from allCandidates (or falls back to its top entry), so
    // the metadata is already sitting in memory from the Step 3 search — no
    // need to re-query Milvus for it.
    let selectedRecordMetadata = null;
    let metadataWarning = null;

    if (classification && classification.selected_series_number) {
      const matchedCandidate = (allCandidates || []).find(
        (c) => String(c.series_number).trim() === String(classification.selected_series_number).trim()
      );

      if (matchedCandidate) {
        selectedRecordMetadata = {
          schedule_number:     matchedCandidate.schedule_number,
          schedule_title:      matchedCandidate.schedule_title,
          series_number:       matchedCandidate.series_number,
          series_title:        matchedCandidate.series_title,
          series_description:  matchedCandidate.description,
          retention_period:    matchedCandidate.retention_period,
          disposition_method:  matchedCandidate.disposition_method,
        };
        logger.success(`Full metadata resolved for series "${classification.selected_series_number}" from cached search results.`);
      } else {
        // Defensive fallback — shouldn't happen since the selected series is
        // always one of allCandidates, but keeps a live Milvus lookup as a
        // safety net if that assumption is ever violated.
        logger.warn(`Series "${classification.selected_series_number}" not found in cached candidates. Falling back to a live Milvus lookup.`);
        try {
          selectedRecordMetadata = await getFullRecord(classification.selected_series_number);
          logger.success(`Full metadata retrieved for series "${classification.selected_series_number}".`);
        } catch (metaErr) {
          logger.error(`Metadata retrieval failed for series "${classification.selected_series_number}":`, metaErr);
          selectedRecordMetadata = null;
          metadataWarning = `Metadata lookup failed for series ${classification.selected_series_number}: ${metaErr.message}`;
        }
      }
    }

    // Step 6: Construct and return response
    const responseBody = {
      success: true,
      message: 'File uploaded successfully.',
      data: {
        filename: uploadedDocument.r2Key,
        originalName: uploadedDocument.originalName,
        mimeType: uploadedDocument.mimeType,
        size: uploadedDocument.size,
      },
      top_3_candidates: top3Candidates,
      classification: classification,
      selected_record_metadata: selectedRecordMetadata,
      out_of_scope: outOfScope,
    };

    const warnings = [searchWarning, classificationWarning, metadataWarning].filter(Boolean);
    if (warnings.length > 0) {
      responseBody.warning = warnings.join(' | ');
    }

    if (config.enableExtractionPreview) {
      responseBody.extraction = {
        fileType: extraction ? extraction.fileType : null,
        text: extraction ? extraction.text : null,
        error: extraction ? (extraction.error || null) : null,
      };
    }

    return res.status(200).json(responseBody);
  } catch (err) {
    logger.error('Unexpected error during file upload.', err);
    next(err);
  }
};

module.exports = {
  handleUpload,
  computeGenericKeywordBoost,
  rerankEdgeCandidates,
  getGs17Record,
};


