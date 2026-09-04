// Frontend document upload, extraction preview, and classification UI logic
const UPLOAD_API_URL = '/api/v1/upload';

// Developer extraction preview flag from backend config
const APP_CONFIG = window.APP_CONFIG || {};
const ENABLE_EXTRACTION_PREVIEW = APP_CONFIG.enableExtractionPreview === true;

// Accepted file extensions
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls'];

// DOM references
const fileInput                     = document.getElementById('file-input');
const dropZone                      = document.getElementById('drop-zone');
const filePreview                   = document.getElementById('file-preview');
const previewName                   = document.getElementById('preview-name');
const previewSize                   = document.getElementById('preview-size');
const previewIcon                   = document.getElementById('preview-icon');
const clearBtn                      = document.getElementById('clear-btn');
const uploadBtn                     = document.getElementById('upload-btn');
const btnLabel                      = document.getElementById('btn-label');
const messageBox                    = document.getElementById('message-box');
const messageText                   = document.getElementById('message-text');
const classificationResultsContainer = document.getElementById('classification-results-container');
const extractedTextPreviewContainer = document.getElementById('extracted-text-preview-container');

// State
let isUploading = false;
let extractedTextPreviewPanel = null;
let extractedTextPreviewTextarea = null;
let extractedTextPreviewToggle = null;

// Escape HTML special characters for safe insertion
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Format raw byte count into human-readable string
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

// Get lowercase file extension
function getExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot).toLowerCase();
}

// Return icon based on file extension
function getFileIcon(extension) {
  if (extension === '.pdf') return '📄';
  if (extension === '.docx') return '📝';
  if (extension === '.xlsx' || extension === '.xls') return '📊';
  return '📎';
}

// Validate file extension
function isValidFileType(file) {
  const ext = getExtension(file.name);
  return ALLOWED_EXTENSIONS.includes(ext);
}

// Clear classification results container
function hideClassificationResults() {
  if (classificationResultsContainer) {
    classificationResultsContainer.innerHTML = '';
  }
}

// Clear extraction preview container
function hideExtractionPreview() {
  if (extractedTextPreviewContainer) {
    extractedTextPreviewContainer.innerHTML = '';
  }
  extractedTextPreviewPanel = null;
  extractedTextPreviewTextarea = null;
  extractedTextPreviewToggle = null;
}

// Render classification result cards and candidates
function showClassificationResults(result) {
  if (!classificationResultsContainer) return;
  hideClassificationResults();

  const metadata = result.selected_record_metadata;
  const classification = result.classification;
  const top3 = result.top_3_candidates;
  const warning = result.warning;
  const outOfScope = result.out_of_scope === true;

  if (!outOfScope && !metadata && !classification && (!top3 || top3.length === 0)) {
    return;
  }

  const section = document.createElement('section');
  section.className = 'results-section';

  let html = '';

  // Out-of-Scope banner when similarity is below threshold
  if (outOfScope) {
    const bestScore = (top3 && top3[0] && typeof top3[0].similarity_score === 'number')
      ? (top3[0].similarity_score * 100).toFixed(1)
      : null;

    html += `
      <div class="out-of-scope-card" role="alert" id="out-of-scope-banner">
        <div class="out-of-scope-icon" aria-hidden="true">⚠️</div>
        <div class="out-of-scope-body">
          <div class="out-of-scope-title">Document Outside GS-17 Scope</div>
          <p class="out-of-scope-text">
            This document does not appear to fall under the
            <strong>GS-17 — Law Enforcement, Fire and Emergency Services</strong> schedule.
            ${bestScore ? `The closest match found has a similarity of only <strong>${escapeHTML(bestScore)}%</strong>, which is below the required threshold.` : ''}
          </p>
          <p class="out-of-scope-text">
            Please verify the document type and ensure it belongs to the GS-17 schedule before classifying.
            The closest candidates are shown below for reference only.
          </p>
        </div>
      </div>
    `;
  }

  // Selected GS-17 record metadata card
  if (!outOfScope && metadata) {
    const confidenceVal = classification && typeof classification.confidence === 'number'
      ? classification.confidence
      : (top3 && top3[0] ? top3[0].similarity_score : null);

    const confidenceText = typeof confidenceVal === 'number'
      ? `Confidence: ${(confidenceVal * 100).toFixed(1)}%`
      : '';

    html += `
      <div class="results-header-block">
        <h2 class="results-title">🎯 Classification Result</h2>
        ${confidenceText ? `<span class="confidence-badge">${escapeHTML(confidenceText)}</span>` : ''}
      </div>

      <div class="metadata-card">
        <div class="meta-grid">
          <div class="meta-item">
            <div class="meta-label">Schedule</div>
            <div class="meta-value">${escapeHTML(metadata.schedule_number || 'GS-17')} — ${escapeHTML(metadata.schedule_title || 'N/A')}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">Series Number</div>
            <div class="meta-value">
              <span class="series-badge">${escapeHTML(metadata.series_number || 'N/A')}</span>
            </div>
          </div>

          <div class="meta-item meta-item--full">
            <div class="meta-label">Series Title</div>
            <div class="meta-value meta-value--title">${escapeHTML(metadata.series_title || 'N/A')}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">Retention Period</div>
            <div class="meta-value">${escapeHTML(metadata.retention_period || 'N/A')}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">Disposition Method</div>
            <div class="meta-value">${escapeHTML(metadata.disposition_method || 'N/A')}</div>
          </div>

          ${metadata.series_description ? `
            <div class="meta-item meta-item--full">
              <div class="meta-label">Description</div>
              <div class="meta-value">${escapeHTML(metadata.series_description)}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // AI reasoning card
  if (!outOfScope && classification && classification.ai_reasoning) {
    html += `
      <div class="reasoning-card">
        <div class="reasoning-title">🧠 AI Reasoning</div>
        <p class="reasoning-text">${escapeHTML(classification.ai_reasoning)}</p>
      </div>
    `;
  }

  // Top candidate matches card
  if (Array.isArray(top3) && top3.length > 0) {
    const selectedSeriesNum = (!outOfScope && classification)
      ? classification.selected_series_number
      : ((!outOfScope && metadata) ? metadata.series_number : null);

    const candidatesHtml = top3.map((cand, idx) => {
      const isSelected = selectedSeriesNum && String(cand.series_number).trim() === String(selectedSeriesNum).trim();
      const scorePct = typeof cand.similarity_score === 'number'
        ? (cand.similarity_score * 100).toFixed(1)
        : 'N/A';

      return `
        <div class="candidate-item ${isSelected ? 'candidate-item--selected' : ''}">
          <div class="rank-badge">${escapeHTML(String(cand.rank || (idx + 1)))}</div>
          <div class="candidate-info">
            <div class="candidate-header">
              <span class="candidate-series">${escapeHTML(cand.series_number || 'N/A')}</span>
              <span class="candidate-title">${escapeHTML(cand.series_title || 'N/A')}</span>
              ${isSelected ? '<span class="selected-tag">Selected</span>' : ''}
              <span class="similarity-tag">Similarity: ${escapeHTML(scorePct)}%</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const candidatesLabel = outOfScope
      ? 'TOP 3 CANDIDATES (for reference only — no classification made)'
      : 'TOP 3 CANDIDATES (for reference)';

    html += `
      <div class="candidates-card">
        <div class="candidates-title">${escapeHTML(candidatesLabel)}</div>
        <div class="candidates-list">
          ${candidatesHtml}
        </div>
      </div>
    `;
  }

  // System warning banner
  if (warning) {
    html += `
      <div class="warning-card">
        ⚠️ <strong>Warning:</strong> ${escapeHTML(warning)}
      </div>
    `;
  }

  section.innerHTML = html;
  classificationResultsContainer.appendChild(section);

  setTimeout(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}



// Extracted text developer preview component
function createExtractionPreviewSection() {
  if (!ENABLE_EXTRACTION_PREVIEW || !extractedTextPreviewContainer) return;
  if (extractedTextPreviewPanel) return;

  const section = document.createElement('section');
  section.className = 'extracted-text-preview';
  section.id = 'extracted-text-preview';

  const header = document.createElement('div');
  header.className = 'extracted-text-preview__header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'extracted-text-preview__title-group';

  const sectionLabel = document.createElement('p');
  sectionLabel.className = 'section-label';
  sectionLabel.textContent = 'Preview';

  const title = document.createElement('h2');
  title.className = 'extracted-text-preview__title';
  title.textContent = 'Extracted Text (Preview)';

  titleGroup.appendChild(sectionLabel);
  titleGroup.appendChild(title);

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'extracted-text-preview__toggle';
  toggleButton.textContent = 'Expand';
  toggleButton.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('div');
  panel.className = 'extracted-text-preview__panel';
  panel.hidden = true;

  const textarea = document.createElement('textarea');
  textarea.className = 'extracted-text-preview__content';
  textarea.readOnly = true;
  textarea.spellcheck = false;
  textarea.wrap = 'off';
  textarea.setAttribute('aria-label', 'Extracted text preview');

  panel.appendChild(textarea);
  header.appendChild(titleGroup);
  header.appendChild(toggleButton);
  section.appendChild(header);
  section.appendChild(panel);

  toggleButton.addEventListener('click', function () {
    const shouldExpand = panel.hidden;
    panel.hidden = !shouldExpand;
    toggleButton.textContent = shouldExpand ? 'Collapse' : 'Expand';
    toggleButton.setAttribute('aria-expanded', String(shouldExpand));
  });

  extractedTextPreviewContainer.appendChild(section);

  extractedTextPreviewPanel = panel;
  extractedTextPreviewTextarea = textarea;
  extractedTextPreviewToggle = toggleButton;
}

// Display extracted text in the preview textarea
function showExtractionPreview(text) {
  if (!ENABLE_EXTRACTION_PREVIEW) return;
  if (typeof text !== 'string' || text.trim().length === 0) {
    hideExtractionPreview();
    return;
  }

  createExtractionPreviewSection();
  if (!extractedTextPreviewPanel || !extractedTextPreviewTextarea || !extractedTextPreviewToggle) return;

  extractedTextPreviewTextarea.value = text;
  extractedTextPreviewPanel.hidden = false;
  extractedTextPreviewToggle.textContent = 'Collapse';
  extractedTextPreviewToggle.setAttribute('aria-expanded', 'true');
}

// Update file preview card in UI
function showFilePreview(file) {
  const ext = getExtension(file.name);
  previewIcon.textContent = getFileIcon(ext);
  previewName.textContent = file.name;
  previewSize.textContent = formatFileSize(file.size);
  filePreview.classList.add('visible');
}

// Reset file preview and clear inputs
function clearFilePreview() {
  filePreview.classList.remove('visible');
  previewName.textContent = '';
  previewSize.textContent = '';
  fileInput.value = '';
  hideClassificationResults();
  hideExtractionPreview();
}

// Show alert/message banner
function showMessage(type, title, detail) {
  const icon = type === 'success' ? '✓' : '✕';

  messageText.innerHTML = `
    <strong>${escapeHTML(title)}</strong>
    ${detail ? `<span>${escapeHTML(detail)}</span>` : ''}
  `;

  messageBox.className = `message ${type} visible`;
  document.getElementById('message-icon').textContent = icon;
}

// Hide alert/message banner
function hideMessage() {
  messageBox.className = 'message';
}

// Update UI button and spinner during upload/classification
function setLoadingState(loading) {
  isUploading = loading;
  uploadBtn.disabled = loading;
  uploadBtn.classList.toggle('loading', loading);
  btnLabel.textContent = loading ? 'Processing & Classifying…' : 'Classify Document';
}

// File selection handler
function handleFileSelected(file) {
  if (!file) return;

  hideMessage();
  hideClassificationResults();
  hideExtractionPreview();

  if (!isValidFileType(file)) {
    showMessage('error', 'Unsupported file type', 'Please select a PDF, DOCX, or Excel file.');
    fileInput.value = '';
    return;
  }

  showFilePreview(file);
}

fileInput.addEventListener('change', function () {
  if (fileInput.files.length > 0) {
    handleFileSelected(fileInput.files[0]);
  }
});

clearBtn.addEventListener('click', function (event) {
  event.stopPropagation();
  clearFilePreview();
  hideMessage();
});

// Drag and drop event listeners
dropZone.addEventListener('dragover', function (event) {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', function () {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', function (event) {
  event.preventDefault();
  dropZone.classList.remove('drag-over');

  const droppedFile = event.dataTransfer.files[0];
  if (droppedFile) {
    const dt = new DataTransfer();
    dt.items.add(droppedFile);
    fileInput.files = dt.files;
    handleFileSelected(droppedFile);
  }
});

// Upload and classify click handler
uploadBtn.addEventListener('click', async function () {
  if (isUploading) return;

  if (!fileInput.files || fileInput.files.length === 0) {
    showMessage('error', 'No file selected', 'Please choose a PDF, DOCX, or Excel file before uploading.');
    return;
  }

  const file = fileInput.files[0];

  if (!isValidFileType(file)) {
    showMessage('error', 'Unsupported file type', 'Please select a PDF, DOCX, or Excel file.');
    return;
  }

  const formData = new FormData();
  formData.append('document', file);

  setLoadingState(true);
  hideMessage();
  hideClassificationResults();
  hideExtractionPreview();

  try {
    const response = await fetch(UPLOAD_API_URL, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (result.success) {
      const sizeLabel = formatFileSize(result.data.size);

      showMessage(
        'success',
        'File uploaded & classified successfully.',
        `${result.data.originalName} · ${sizeLabel}`
      );

      clearFilePreview();

      // Display classification results, AI reasoning, and candidate list
      showClassificationResults(result);

      // Display extracted text preview if enabled
      if (ENABLE_EXTRACTION_PREVIEW && result.extraction && result.extraction.text) {
        showExtractionPreview(result.extraction.text);
      }

    } else {
      showMessage('error', result.message || 'Classification failed.', '');
    }

  } catch (err) {
    showMessage('error', 'Could not reach the server.', 'Please check your connection and try again.');
    console.error('Upload fetch error:', err);
  }

  setLoadingState(false);
});



