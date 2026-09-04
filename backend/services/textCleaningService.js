// Text normalization and cleaning service for extracted document text
const logger = require('../utils/logger');

// Strip legal boilerplate and citation patterns
const removeBoilerplate = (text) => {
  try {
    const boilerplatePatterns = [
      /COV\s+\d+\.\d+-\d+/gi,                             // COV citations
      /\d+\s*CFR\s+\d+\.\d+/gi,                           // CFR citations
      /28\s*C\.?F\.?R\.?/gi,                              // Standard CFR references
      /This series (may include|documents|consists of)/gi, // Generic series boilerplate
      /Distribution:\s*[^\n]+/gi,                         // Distribution lines
      /Signature.*?Date:/gi,                              // Signature blocks
      /approved\s+by\s+[^\n]+/gi                          // Approval lines
    ];

    return boilerplatePatterns.reduce((txt, pattern) => txt.replace(pattern, ''), text);
  } catch (err) {
    logger.warn(`removeBoilerplate warning: ${err.message}`);
    return text;
  }
};

const MONTH_MAP = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

// Normalize dates to ISO 8601 format (YYYY-MM-DD)
const normalizeDates = (text) => {
  try {
    let result = text;

    // Pattern: "Month DD, YYYY"
    result = result.replace(/(\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s+(\d{1,2}),?\s+(\d{4})\b/gi,
      (match, month, day, year) => {
        const monthNum = MONTH_MAP[month.toLowerCase()];
        if (!monthNum) return match;
        return `${year}-${monthNum}-${day.padStart(2, '0')}`;
      }
    );

    // Pattern: "DD Month YYYY"
    result = result.replace(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/gi,
      (match, day, month, year) => {
        const monthNum = MONTH_MAP[month.toLowerCase()];
        if (!monthNum) return match;
        return `${year}-${monthNum}-${day.padStart(2, '0')}`;
      }
    );

    // Pattern: "MM/DD/YYYY"
    result = result.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (match, month, day, year) => {
      const m = parseInt(month, 10);
      const d = parseInt(day, 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      return match;
    });

    return result;
  } catch (err) {
    logger.warn(`normalizeDates warning: ${err.message}`);
    return text;
  }
};

// Remove standalone page numbers and separator lines
const removePageNumbers = (text) => {
  try {
    const artifactPatterns = [
      /^Page\s+\d+\s*(?:of\s+\d+)?\s*$/gmi,
      /^\d+\s*$/gm,
      /^[-=_]{3,}$/gm,
      /\|\s*\d+\s*\|/g,
      /^===+$/gm,
      /\[Page\s+\d+\]/gi,
    ];

    let result = text;
    for (const pattern of artifactPatterns) {
      result = result.replace(pattern, '');
    }
    return result;
  } catch (err) {
    logger.warn(`removePageNumbers warning: ${err.message}`);
    return text;
  }
};

const ABBREVIATIONS = {
  // Department / Agency
  'Dept\\.': 'Department',
  'Dept[s]?(?![a-z])': 'Department',
  'Co\\.': 'Company',
  'Corp\\.': 'Corporation',
  'Org\\.': 'Organization',
  'Govt\\.': 'Government',
  'Mgmt\\.': 'Management',
  'Admin\\.': 'Administration',
  'Div\\.': 'Division',
  'Sec\\.': 'Section',
  'Inc\\.': 'Incorporated',
  'Ltd\\.': 'Limited',

  // Legal / Records
  'v\\.': 'versus',
  'et al\\.': 'and others',
  'e\\.g\\.': 'for example',
  'i\\.e\\.': 'that is',
  'etc\\.': 'and so on',

  // Titles
  'Mr\\.': 'Mister',
  'Ms\\.': 'Miss',
  'Dr\\.': 'Doctor',
  'Prof\\.': 'Professor',
  'Sr\\.': 'Senior',
  'Jr\\.': 'Junior',
};

// Expand common organizational and legal abbreviations
const expandAbbreviations = (text) => {
  try {
    let result = text;
    for (const [abbrev, full] of Object.entries(ABBREVIATIONS)) {
      const regex = new RegExp(`\\b${abbrev}`, 'gi');
      result = result.replace(regex, full);
    }
    return result;
  } catch (err) {
    logger.warn(`expandAbbreviations warning: ${err.message}`);
    return text;
  }
};

// Deduplicate identical adjacent/repeated lines
const removeDuplicateLines = (text) => {
  try {
    const lines = text.split('\n');
    const uniqueLines = [];
    const seen = new Set();

    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed === '') {
        uniqueLines.push('');
      } else if (!seen.has(trimmed)) {
        seen.add(trimmed);
        uniqueLines.push(line);
      }
    }

    return uniqueLines.join('\n');
  } catch (err) {
    logger.warn(`removeDuplicateLines warning: ${err.message}`);
    return text;
  }
};

// Pipeline for government document text cleaning
const cleanGovernmentDocument = (text) => {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;
  cleaned = removeBoilerplate(cleaned);
  cleaned = normalizeDates(cleaned);
  cleaned = removePageNumbers(cleaned);
  cleaned = expandAbbreviations(cleaned);
  cleaned = removeDuplicateLines(cleaned);

  return cleaned;
};

// Basic whitespace and line utilities
const normalizeLineEndings = (text) => {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
};

const removeInvisibleCharacters = (text) => {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '');
};

const trimWhitespaceFromLines = (lines) => {
  return lines.map((line) => line.replace(/^[ \t]+/g, '').replace(/[ \t]+$/g, ''));
};

const collapseExtraBlankLines = (lines) => {
  const cleanedLines = [];
  let previousWasBlank = false;

  for (const line of lines) {
    const isBlankLine = line.trim() === '';
    if (isBlankLine && previousWasBlank) {
      continue;
    }
    cleanedLines.push(line);
    previousWasBlank = isBlankLine;
  }

  return cleanedLines;
};

const trimOuterBlankLines = (lines) => {
  let startIndex = 0;
  let endIndex = lines.length - 1;

  while (startIndex <= endIndex && lines[startIndex].trim() === '') {
    startIndex += 1;
  }

  while (endIndex >= startIndex && lines[endIndex].trim() === '') {
    endIndex -= 1;
  }

  return lines.slice(startIndex, endIndex + 1);
};

const normalizeInternalSpacing = (line) => {
  if (line.includes('\t') || line.includes('|')) {
    return line;
  }
  return line.replace(/ {3,}/g, ' ');
};

// Clean extracted text with metrics and applied rules
const cleanExtractedText = (text, context = {}) => {
  const sourceText = typeof text === 'string' ? text : '';
  const sourceLabel = context.r2Key || context.source || 'unknown document';
  const fileTypeLabel = context.fileType ? ` (${context.fileType})` : '';
  const originalLength = sourceText.length;

  if (sourceText.length === 0) {
    logger.warn(`Text cleaning skipped for "${sourceLabel}"${fileTypeLabel} because the input text is empty.`);
    return {
      text: '',
      originalLength: 0,
      cleanedLength: 0,
      wasChanged: false,
      appliedRules: [],
    };
  }

  try {
    let cleanedText = sourceText;
    const appliedRules = [];

    // Line ending and invisible character normalization
    const normalizedLineEndings = normalizeLineEndings(cleanedText);
    if (normalizedLineEndings !== cleanedText) {
      cleanedText = normalizedLineEndings;
      appliedRules.push('normalizeLineEndings');
    }

    const removedInvisibleCharacters = removeInvisibleCharacters(cleanedText);
    if (removedInvisibleCharacters !== cleanedText) {
      cleanedText = removedInvisibleCharacters;
      appliedRules.push('removeInvisibleCharacters');
    }

    // Domain-specific cleaning
    const govCleaned = cleanGovernmentDocument(cleanedText);
    if (govCleaned !== cleanedText) {
      cleanedText = govCleaned;
      appliedRules.push('cleanGovernmentDocument');
    }

    // Whitespace trimming and line collapsing
    const lines = cleanedText.split('\n');
    const trimmedLines = trimWhitespaceFromLines(lines);
    if (trimmedLines.join('\n') !== cleanedText) {
      cleanedText = trimmedLines.join('\n');
      appliedRules.push('trimWhitespaceFromLines');
    }

    const collapsedBlankLines = collapseExtraBlankLines(cleanedText.split('\n'));
    if (collapsedBlankLines.join('\n') !== cleanedText) {
      cleanedText = collapsedBlankLines.join('\n');
      appliedRules.push('collapseExtraBlankLines');
    }

    const trimmedOuterBlankLines = trimOuterBlankLines(cleanedText.split('\n'));
    if (trimmedOuterBlankLines.join('\n') !== cleanedText) {
      cleanedText = trimmedOuterBlankLines.join('\n');
      appliedRules.push('trimOuterBlankLines');
    }

    const internalSpacingNormalized = cleanedText
      .split('\n')
      .map(normalizeInternalSpacing)
      .join('\n');

    if (internalSpacingNormalized !== cleanedText) {
      cleanedText = internalSpacingNormalized;
      appliedRules.push('normalizeInternalSpacing');
    }

    cleanedText = cleanedText.trimEnd();

    const cleanedLength = cleanedText.length;
    const wasChanged = cleanedText !== sourceText;

    if (wasChanged) {
      logger.success(
        `---> Text cleaning complete for "${sourceLabel}"${fileTypeLabel} — ${originalLength} -> ${cleanedLength} characters.\n`
      );
    }

    return {
      text: cleanedText,
      originalLength: originalLength,
      cleanedLength: cleanedLength,
      wasChanged: wasChanged,
      appliedRules: appliedRules,
    };
  } catch (err) {
    logger.warn(`---> Text cleaning failed for "${sourceLabel}"${fileTypeLabel}: ${err.message}. Returning raw extracted text.\n`);

    return {
      text: sourceText,
      originalLength: originalLength,
      cleanedLength: originalLength,
      wasChanged: false,
      appliedRules: [],
    };
  }
};

// Simplified clean text helper returning string only
const cleanText = (text) => {
  if (!text || typeof text !== 'string') return '';
  const result = cleanExtractedText(text);
  return result.text;
};

/**
 * Creates a balanced Head + Representative Middle + Tail context window for long documents.
 * Documents shorter than or equal to maxLength are returned 100% untouched.
 *
 * @param {string} text - The input cleaned document text.
 * @param {Object} options - Configuration options.
 * @param {number} options.maxLength - Maximum allowable character length (default: 4000).
 * @param {number} options.headRatio - Fraction of maxLength allocated to the head section (default: 0.375).
 * @param {number} options.middleRatio - Fraction of maxLength allocated to the middle section (default: 0.25).
 * @param {number} options.tailRatio - Fraction of maxLength allocated to the tail section (default: 0.375).
 * @returns {string} The balanced context window.
 */
const createDocumentContextWindow = (text, options = {}) => {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }

  const maxLength = typeof options.maxLength === 'number' && options.maxLength > 0
    ? options.maxLength
    : 4000;

  // Short documents remain 100% unchanged
  if (text.length <= maxLength) {
    return text;
  }

  const headRatio = typeof options.headRatio === 'number' ? options.headRatio : 0.375;
  const middleRatio = typeof options.middleRatio === 'number' ? options.middleRatio : 0.25;
  const tailRatio = typeof options.tailRatio === 'number' ? options.tailRatio : 0.375;

  // Estimate delimiter overhead conservatively
  const isCompact = maxLength <= 2000;
  const sampleMarker1 = isCompact ? '\n[...]\n' : '\n\n[... Head to Middle Transition (999999 characters omitted) ...]\n\n';
  const sampleMarker2 = isCompact ? '\n[...]\n' : '\n\n[... Middle to Tail Transition (999999 characters omitted) ...]\n\n';
  const reservedDelimiterOverhead = sampleMarker1.length + sampleMarker2.length;

  const contentBudget = Math.max(150, maxLength - reservedDelimiterOverhead);

  const headLength = Math.max(50, Math.floor(contentBudget * headRatio));
  const middleLength = Math.max(50, Math.floor(contentBudget * middleRatio));
  const tailLength = Math.max(50, Math.floor(contentBudget * tailRatio));

  // 1. Head excerpt
  const headExcerpt = text.slice(0, headLength).trimEnd();

  // 2. Middle excerpt centered around the midpoint of the document
  const midPoint = Math.floor(text.length / 2);
  const midStart = Math.max(headLength, midPoint - Math.floor(middleLength / 2));
  const midEnd = Math.min(text.length - tailLength, midStart + middleLength);
  const middleExcerpt = text.slice(midStart, midEnd).trim();

  // 3. Tail excerpt
  const tailExcerpt = text.slice(text.length - tailLength).trimStart();

  const omittedBeforeMid = Math.max(0, midStart - headLength);
  const omittedAfterMid = Math.max(0, (text.length - tailLength) - midEnd);

  const marker1 = isCompact
    ? '\n[...]\n'
    : `\n\n[... Head to Middle Transition (${omittedBeforeMid} characters omitted) ...]\n\n`;
  const marker2 = isCompact
    ? '\n[...]\n'
    : `\n\n[... Middle to Tail Transition (${omittedAfterMid} characters omitted) ...]\n\n`;

  const assembled = `${headExcerpt}${marker1}${middleExcerpt}${marker2}${tailExcerpt}`;

  // Strict hard ceiling guarantee
  if (assembled.length > maxLength) {
    return assembled.slice(0, maxLength);
  }

  return assembled;
};

module.exports = {
  cleanExtractedText,
  cleanText,
  cleanGovernmentDocument,
  createDocumentContextWindow,
  removeBoilerplate,
  normalizeDates,
  removePageNumbers,
  expandAbbreviations,
  removeDuplicateLines,
};