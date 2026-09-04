// Text extraction controller
const extractionService = require('../services/extractionService');
const textCleaningService = require('../services/textCleaningService');
const logger = require('../utils/logger');

// Handles POST /api/v1/extract
const handleExtract = async (req, res, next) => {
  try {
    const { r2Key } = req.body;

    // Validate r2Key input
    if (!r2Key || typeof r2Key !== 'string' || r2Key.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: "r2Key". Provide the R2 object key of the uploaded file.',
      });
    }

    // Retrieve file, extract text, and clean content
    const result = await extractionService.retrieveAndExtract(r2Key.trim());
    const cleanedResult = textCleaningService.cleanExtractedText(result.text, {
      r2Key: r2Key.trim(),
      fileType: result.fileType,
      source: 'extraction-api',
    });

    return res.status(200).json({
      success:  true,
      fileType: result.fileType,
      text:     cleanedResult.text,
    });
  } catch (err) {
    logger.error('Extraction failed.', err);
    const message = err.message || 'Text extraction failed.';

    if (message.includes('Unsupported file type')) {
      return res.status(400).json({ success: false, message });
    }

    if (message.includes('NoSuchKey') || message.includes('does not exist')) {
      return res.status(404).json({
        success: false,
        message: 'File not found in storage. Verify the r2Key is correct.',
      });
    }

    // Handle corrupt or unparseable files
    if (
      message.includes('Invalid PDF') ||
      message.includes('Invalid DOCX') ||
      message.includes('bad XLS') ||
      message.includes('Corrupted zip') ||
      message.includes('Parse error') ||
      err.name === 'InvalidPDFException'
    ) {
      return res.status(422).json({
        success: false,
        message: 'The file could not be parsed. It may be corrupted or in an unsupported format.',
      });
    }

    // Forward unexpected errors to global error handler
    next(err);
  }
};

module.exports = {
  handleExtract,
};

