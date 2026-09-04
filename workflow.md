# AI-Based Document Classification System — Complete Architecture & Workflow Guide

---

## 1. Project Overview

The **AI-Based Document Classification System** is an automated, full-stack application that classifies government, municipal, and institutional digital documents into the official **Library of Virginia (LVA) General Records Retention Schedules** — specifically **GS-17 (Law Enforcement, Fire, and Emergency Services)** across all 88 official record series.

### The Problem It Solves
State, county, and municipal agencies (police departments, sheriff's offices, 911 dispatch centers, fire & rescue squads) process high volumes of digital records daily:
- Incident reports & investigative case files (felony vs. misdemeanor, resolved vs. unresolved)
- Arrest records (adult, juvenile, deceased)
- 911 audio dispatch call logs and CAD reports
- Vehicle impound slips & traffic crash reports
- Body-worn camera / surveillance logs
- Fire & EMS patient care records

Each category is legally governed by statutory rules mandating:
1. **Statutory Retention Period:** How long the record must be retained (e.g., *"75 years after closed"*, *"100 years after birth"*, *"3 years after vehicle sold"*).
2. **Mandated Disposal Method:** How it must be destroyed (e.g., *"Confidential Destruction"*, *"Non-confidential Destruction"*, *"Permanent In Agency"*).

Traditional keyword search fails due to unstructured narratives, synonyms, OCR noise, and nuanced legal distinctions.

### The Solution: Hybrid RAG Pipeline
This project implements a hybrid **Semantic Vector Search + Metadata-Driven Keyword Reranking + Retrieval-Augmented Generation (RAG)** pipeline:
1. Ingests multi-format files (PDF, DOCX, XLSX/XLS, scanned image PDFs via OCR) and buffers them to **Cloudflare R2**.
2. Cleans and normalizes text through a 7-stage pipeline.
3. Converts text into mathematical **vector embeddings (768-dimensional)** using Cloudflare Workers AI.
4. Performs high-speed Cosine similarity search against all **88 official GS-17 record series** in **Zilliz Cloud / Milvus Vector Database**.
5. Employs **Metadata-Driven Keyword Scoring** to boost precision on close candidate margins.
6. Enforces **Similarity Threshold Gating ($\ge 0.65$)** to prevent out-of-scope hallucinations.
7. Uses **Llama 3.1 8B Instruct** via Cloudflare Workers AI to reason over top candidates and select the single best record series.
8. Computes a **Composite Confidence Score** combining mathematical similarity with linguistic AI certainty.

---

## 2. Technology Stack

| Component | Technology | Version / Model | Purpose |
| :--- | :--- | :--- | :--- |
| **Backend Runtime** | Node.js | v22.13+ | High-performance asynchronous runtime (pinned via `engines` in `package.json` — required by the patched `pdfjs-dist`) |
| **Web Framework** | Express.js | `^5.2.1` | HTTP REST API routing & middleware |
| **Cloud Object Storage** | Cloudflare R2 (`@aws-sdk/client-s3`) | `^3.1081.0` | S3-compatible cloud buffer storage |
| **File Extraction** | `pdf-parse`, `pdfjs-dist`, `mammoth`, `xlsx` | Native / npm | Multi-format text extraction (PDF, Word, Excel) |
| **OCR Engine** | `tesseract.js` + `@napi-rs/canvas` | `^7.0.0` / `^3.2.3` | Persistent 3-worker OCR pool for scanned/image PDFs |
| **Vector Embeddings** | Cloudflare Workers AI | `@cf/baai/bge-base-en-v1.5` | 768-dimensional dense semantic embeddings |
| **Vector Database** | Zilliz Cloud / Milvus | `@zilliz/milvus2-sdk-node` | Vector indexing and Cosine similarity search |
| **LLM Classifier** | Cloudflare Workers AI | `@cf/meta/llama-3.1-8b-instruct` | RAG candidate selection & legal reasoning |
| **Rate Limiting** | `express-rate-limit` | `^8.7.0` | Per-IP request throttling on the upload/extract endpoints |
| **Frontend UI** | HTML5, Vanilla CSS3, Vanilla JS | Native | Glassmorphic UI with Dark/Light theme switching |

---

## 3. High-Level Architecture & End-to-End Workflow

```
[ User in Browser (index.html / upload.js) ]
                    │
                    ▼  (1) POST /api/v1/upload (multipart/form-data)
[ Express Server & uploadRoutes.js ]
                    │
                    ▼  (2) Rate limit check (20 req / 15 min per IP), then
                    │      validate file type & size (max 2MB)
[ rateLimitMiddleware.js / uploadMiddleware.js ]
                    │
                    ▼  (3) Run concurrently — both read the same in-memory
                    │      upload buffer, no extra R2 round trip
        ┌───────────┴────────────────┐
        ▼                            ▼
[ r2Service.js               [ extractionService.js / ocrService.js
  (archive to R2) ]            (PDF / DOCX / XLSX / OCR extraction) ]
        └───────────┬────────────────┘
                    ▼  (4) 7-Stage Text Cleaning & Normalization
[ textCleaningService.js ]
                    │
                    ▼  (5) Generate 768-dim Float Vector (Context-Framed)
[ embeddingService.js (Cloudflare Workers AI: bge-base-en-v1.5) ]
                    │
                    ▼  (6) Cosine Similarity Vector Search (Top-8 Candidates)
[ milvusService.js (Collection: gs17_records) ]
                    │
                    ▼  (7) Metadata-Driven Keyword Scoring & Edge Reranking
[ uploadController.js (computeGenericKeywordBoost) ]
                    │
                    ├──────────► [ Similarity < 0.65 ] ──► Return Out-of-Scope Warning (Bypass LLM)
                    │
                    ▼  (8) If Similarity >= 0.65: RAG Prompting & Selection
[ classificationService.js (Cloudflare Workers AI: Llama 3.1 8B Instruct) ]
                    │
                    ▼  (9) Resolve full statutory metadata from the
                    │      candidates already fetched in step 6 & compute
                    │      Composite Confidence — no extra Milvus round trip
[ uploadController.js / classificationService.js
  (milvusService.getFullRecord() kept only as a defensive fallback) ]
                    │
                    ▼  (10) Standardized JSON Response
[ Frontend UI: Render Metadata Card, AI Reasoning, Top 3 Candidates, Extracted Text Preview ]
```

> Steps 3 (archive + extract) and 9 (metadata resolution) were optimized to cut
> redundant network round trips from the original pipeline — see Section 7,
> "Deep Dive: Security Hardening, Rate Limiting & Performance."

---

## 4. Deep Dive: How Vector Embeddings Work

### 4.1 What is an Embedding?
An **embedding** converts raw human text into an array of floating-point numbers in a high-dimensional mathematical vector space. Text with similar legal meaning is positioned close together:
- *"Vehicle impound tow slip with owner disposal authorization"* and *"Abandoned vehicle identification and auction records"* produce closely aligned vectors even if they share few identical words.

### 4.2 The Embedding Model
- **Model:** `@cf/baai/bge-base-en-v1.5` hosted on **Cloudflare Workers AI**.
- **Vector Dimension:** Exactly `768` floating-point numbers.
- **Metric:** `MetricType.COSINE`.

### 4.3 Classification Framing Context
When `useContextEmbedding` is active, [`embeddingService.js`](file:///d:/1%29%20Internship/DOC-CLASS-CP-main%20-%20light%20theme/backend/services/embeddingService.js) frames document text before vector generation:
```text
You are analyzing a government/organizational document for records retention classification.
Focus on: document type, legal purpose, case status, subject matter, and record lifecycle.
Document text:
"""
<Cleaned Document Text>
"""
Analyze this document carefully.
```
This establishes a semantic baseline so concise records (e.g., short impound slips) embed with appropriate domain density.

### 4.4 Milvus Storage & Querying
1. All **88 official GS-17 record series** from [`gs-17.json`](file:///d:/1%29%20Internship/DOC-CLASS-CP-main%20-%20light%20theme/gs-17.json) are embedded and stored in the `gs17_records` collection.
2. The collection uses an `AUTOINDEX` configured with `COSINE` distance metric.
3. During upload, the document vector queries Milvus with `limit: 8`, returning the Top-8 candidates with exact cosine scores ($0.000$ to $1.000$).

---

## 5. Deep Dive: Metadata-Driven Keyword Reranking

In government records, two series may share 90%+ vocabulary but differ based on key criteria (e.g., *Series 200146: Less Serious Offenses - Resolved* vs. *Series 200147: Less Serious Offenses - Unresolved*).

In [`uploadController.js`](file:///d:/1%29%20Internship/DOC-CLASS-CP-main%20-%20light%20theme/backend/controllers/uploadController.js#L51-L124), the system applies a **Schedule-Agnostic Keyword Reranker**:
1. Candidate objects are enriched with `key_criteria` loaded from [`gs-17.json`](file:///d:/1%29%20Internship/DOC-CLASS-CP-main%20-%20light%20theme/gs-17.json).
2. The document text is scanned for hits against each candidate's `key_criteria` array.
3. A proportional boost (up to `+0.030`) is added to the similarity score:
   $$\text{Boost} = \min\left(0.030,\; \frac{\text{Matched Keywords}}{\text{Total Keywords}} \times 0.030\right)$$
4. Candidates are dynamically re-sorted before being sent to the LLM.

---

## 6. Deep Dive: RAG Classification & Confidence Framework

### 6.1 Similarity Threshold Gating
- **Threshold:** `MIN_SIMILARITY_THRESHOLD = 0.65`.
- **Purpose:** Prevents hallucinations when users upload documents outside the GS-17 domain (e.g., GS-15 Finance, GS-14 HR, or personal resumes).
- **Behavior:**
  - If Top-1 Similarity $< 0.65$: Sets `out_of_scope: true`, skips LLM execution, returns top candidates for informational reference only, and displays a warning banner in the UI.
  - If Top-1 Similarity $\ge 0.65$: Proceeds to RAG classification.

### 6.2 The Prompt Contract & Candidate Selection
In [`classificationService.js`](file:///d:/1%29%20Internship/DOC-CLASS-CP-main%20-%20light%20theme/backend/services/classificationService.js), a strict prompt presents the cleaned document text alongside the candidate series (including `scope_notes`, `key_criteria`, and `exclusions`).

The LLM is constrained to:
- Select **ONLY** from the provided candidate series numbers.
- Ground explanations strictly in factual document text.
- Return structured JSON:
```json
{
  "selected_series_number": "100812",
  "reasoning": "The document is a vehicle tow and impound inventory slip matching Series 100812 exactly."
}
```

### 6.3 Dual Metric: Similarity vs. Confidence
The system distinguishes between **Mathematical Similarity** and **Final Confidence**:

| Metric | Source | Range | Description |
| :--- | :--- | :--- | :--- |
| **`similarity_score`** | Milvus Vector DB | `0.00` – `1.00` | Mathematical cosine similarity between vectors |
| **`confidence`** | RAG Classifier | `0.65` – `0.95` | Final trust rating (Base Similarity + AI Certainty Boost) |

#### Confidence Formula:
$$\text{Final Confidence} = \min\Big(0.95,\; \max\big(\text{Base Similarity},\; \text{Base Similarity} + \text{AI Boost}\big)\Big)$$

1. **Linguistic Scanner:** Scans LLM reasoning for certainty keywords:
   - **`HIGH`** (*"exact match"*, *"clearly matches"*, *"precisely"*, *"unambiguously"*): Applies a dynamic boost between `+0.08` and `+0.12`.
   - **`MEDIUM` / `LOW`** (*"aligns"*, *"appears"*, *"might"*, *"possibly"*): Boost is `+0.00`.
2. **Guarantees:**
   - **Non-Penalizing:** Final confidence is never lower than base similarity.
   - **0.95 Ceiling Cap:** Strictly capped at `0.95` (95%) because legal records classification preserves headroom for final human administrative sign-off.

---

## 7. Deep Dive: Security Hardening, Rate Limiting & Performance

The application was originally built with no authentication, wide-open CORS,
and no request throttling — reasonable for local development, but not for a
publicly reachable deployment. Ahead of going live on Render, the following
hardening pass was applied.

### 7.1 CORS Lockdown
Cross-origin browser requests are now **blocked by default**. [`server.js`](file:///d:/1%29%20Internship/DOC-CLASS-CC/backend/server.js) reads a `CORS_ORIGIN` environment variable (comma-separated origin list); if unset, `cors({ origin: false })` is applied. The bundled frontend is served from the same origin as the API, so no cross-origin access is needed in the default deployment.

### 7.2 Rate Limiting
[`rateLimitMiddleware.js`](file:///d:/1%29%20Internship/DOC-CLASS-CC/backend/middleware/rateLimitMiddleware.js) applies per-IP throttling via `express-rate-limit`, protecting the paid downstream APIs (R2, Milvus, Cloudflare Workers AI) from being drained by scripted or excessive requests:
- `POST /api/v1/upload` — 20 requests / 15 minutes per IP
- `POST /api/v1/extract` — 30 requests / 15 minutes per IP
- Throttled requests receive a `429` with the same `{ success: false, message }` JSON shape used everywhere else.

### 7.3 Extraction Endpoint Access Control
`POST /api/v1/extract` accepts a raw R2 object key and returns that file's extracted text with no ownership check. Since R2 keys are generated as `<timestamp>-<sanitized-filename>.<ext>` (not a secret) and this endpoint isn't called by the bundled frontend at all — the upload response already includes the extraction preview inline — it now stays **disabled by default**, gated behind the existing `ENABLE_EXTRACTION_PREVIEW` flag. A developer can still opt in locally for debugging; it must stay `false` in production.

### 7.4 Dependency Patching
An `npm audit` pass surfaced several CVEs directly reachable through the untrusted-file upload pipeline:
- **`pdfjs-dist`** (HIGH — arbitrary JS execution via a malicious PDF, reachable through the malformed-PDF fallback and OCR render path) — patched via `npm audit fix` + a clean reinstall, `6.1.200` → `6.3.289`. This version requires Node ≥22.13, now pinned via an `engines` field in `package.json` so Render provisions a compatible runtime.
- **`qs`, `@xmldom/xmldom`, `brace-expansion`** — moderate/high transitive CVEs, also patched.
- **`xlsx` (SheetJS)** — HIGH severity prototype-pollution + ReDoS advisory with **no fix published on npm** (SheetJS only distributes post-0.18.5 patches via their own CDN). Left as a known, accepted risk given the project's limited/low-traffic usage and the narrow way the library is used here (`extractExcel()` only reads cell text into a string — no downstream use of the parsed workbook object as a prototype or config source).

### 7.5 Pipeline Performance
Two redundant network round trips were found and removed from the upload pipeline (see the Section 3 diagram):
- **Archive + extract now run concurrently.** Previously the file was uploaded to R2, then immediately re-downloaded from R2 to extract text — even though the buffer was already sitting in memory from Multer. [`extractionService.js`](file:///d:/1%29%20Internship/DOC-CLASS-CC/backend/services/extractionService.js) now exposes `extractUploadedFile(buffer, originalname)`, which extracts directly from the in-memory buffer, run via `Promise.all` alongside the R2 archival upload in [`uploadController.js`](file:///d:/1%29%20Internship/DOC-CLASS-CC/backend/controllers/uploadController.js). Failure semantics are unchanged: an R2 failure still fails the whole request; an extraction failure still degrades gracefully.
- **Metadata resolution no longer re-queries Milvus.** The final `getFullRecord()` call fetched fields that were already returned by the original Milvus search a few steps earlier. The candidate list now carries `schedule_number` too, so the selected series' full metadata is read directly from the already-fetched candidates in memory; `getFullRecord()` is kept only as a defensive fallback for the (practically unreachable) case where the selected series isn't found among them.
- **Net effect:** 2 of the ~6 external network calls per request were eliminated. Measured locally: real end-to-end classification requests (Cloudflare embeddings + Milvus search + Llama 3.1 classification, no mocks) landed around 2.3s–3.0s steady-state, down from the ~5s baseline before this pass.

---

## 8. Project File Structure

```text
DOC-CLASS-CP-main - light theme/
│
├── .gitignore                          # Root Git ignore rules (protects .env & secrets)
├── gs-17.json                          # Source dataset of all 88 GS-17 record series
├── context-capsule.md                  # Comprehensive technical context capsule
├── workflow.md                         # This architecture & workflow guide
├── 1.PROJECT_SPECIFICATION.md          # Functional & non-functional requirements
├── 2.ARCHITECTURE.md                   # Layered architecture specifications
├── 3.AI_RULES.md                       # Coding and architectural standards
│
└── backend/
    ├── server.js                       # Express app entry point & middleware mounting
    ├── package.json                    # Node.js dependencies & npm scripts
    ├── .env                            # Local environment variables & secrets (ignored by git)
    ├── .env.example                    # Template for environment variables
    ├── .gitignore                      # Backend-specific ignore rules
    │
    ├── config/
    │   ├── app.config.js               # Centralized configuration validator
    │   └── constants.js                # System limits, MIME types, and constants
    │
    ├── middleware/
    │   ├── uploadMiddleware.js         # Multer memory buffer upload validator (2MB limit)
    │   ├── rateLimitMiddleware.js      # Per-IP rate limiting for upload/extract endpoints
    │   └── errorMiddleware.js          # 404 handler and global JSON error responder
    │
    ├── routes/
    │   ├── index.js                    # GET / (serves UI) and GET /api/health
    │   ├── uploadRoutes.js             # POST /api/v1/upload (rate limited)
    │   └── extractionRoutes.js         # POST /api/v1/extract (dev-only — gated behind ENABLE_EXTRACTION_PREVIEW, rate limited)
    │
    ├── controllers/
    │   ├── uploadController.js         # Pipeline orchestrator, cache manager, & edge reranker
    │   └── extractionController.js     # Text extraction endpoint controller
    │
    ├── services/
    │   ├── uploadService.js            # Upload processor & R2 key generator
    │   ├── r2Service.js                # Cloudflare R2 object storage operations
    │   ├── extractionService.js        # Multi-engine text extractor (PDF, Word, Excel)
    │   ├── ocrService.js               # Persistent Tesseract OCR worker pool with canvas
    │   ├── textCleaningService.js      # 7-stage text normalization & boilerplate stripper
    │   ├── embeddingService.js         # Cloudflare BGE-base 768-dim vector embedding generator
    │   ├── milvusService.js            # Zilliz/Milvus connection, indexing, & vector search
    │   └── classificationService.js    # Cloudflare Llama 3.1 RAG classifier & confidence booster
    │
    ├── utils/
    │   └── logger.js                   # Colorized console logger
    │
    ├── views/
    │   └── index.html                  # Glassmorphic single-page web interface
    │
    ├── public/
    │   ├── css/style.css               # Glassmorphic design system & light/dark theme CSS
    │   └── js/
    │       ├── theme.js                # Dark/Light theme toggle & localStorage persistence
    │       └── upload.js               # Drag-and-drop handler, API caller, & DOM renderer
    │
    └── scripts/
        ├── enrich-and-reembed-all.js   # Batch semantic enrichment & vector population script (GS-17)
        ├── ingest-new-schedules.js     # Milvus ingestion pipeline for GS-02 and GS-14 schedules
        ├── reembed-series.js           # Targeted series re-embedding script
        ├── reenrich-series.js          # Targeted series text-to-embed upsert utility
        ├── diagnose-milvus.js          # Cluster connectivity & vector health diagnostic tool
        ├── benchmark-all-88.js         # 88-series retrieval accuracy benchmark suite
        ├── audit-cross-schedule.js     # Proactive ambiguity audit across schedules (GS-02, GS-14, GS-17)
        ├── validate_schedules.js       # Schedule JSON schema and completeness validator
        ├── test_reranking.js           # 21-case regression test suite for rerankingService
        └── test-area-a-reasoning.js    # LLM reasoning & prompt verification tests
```

---

## 9. Summary of User Experience

1. **Upload:** User navigates to the web UI (`http://localhost:3000` or deployed URL), drags and drops a document (PDF, DOCX, XLSX, or scanned image).
2. **Processing:** The UI displays a live spinner while the server runs the 10-stage pipeline.
3. **Results Display:**
   - **Primary Classification Card:** Assigned GS-17 Series Number, Official Title, and Confidence rating badge.
   - **AI Reasoning Card:** Clear explanation of why the document was assigned this series.
   - **Retention & Disposal Rules:** Statutory retention period (e.g., *"3 years after vehicle sold"*) and legal disposal method (*"Non-confidential Destruction"*).
   - **Top 3 Candidate Matches:** Comparison cards showing candidate matches with similarity percentages.
   - **Extracted Text Drawer:** Collapsible preview showing cleaned text that was processed.
   - **Out-of-Scope Warning Banner:** If top score $< 0.65$, clearly informs the user that the document is outside GS-17 scope.

---

## 10. Handling Short / Concise Documents

### Why Short Documents Can Have Lower Similarity Scores
1. **Semantic Sparsity:** Short text (e.g., a 10-word tow slip) has fewer contextual tokens than dense legal descriptions.
2. **Header-to-Content Ratio:** Generic agency headers (*"Fairfax County Police"*) can overshadow 2-3 critical keywords.

### System Mitigations:
1. **Classification Context Framing:** Prepend domain framing in [`embeddingService.js`](file:///d:/1%29%20Internship/DOC-CLASS-CP-main%20-%20light%20theme/backend/services/embeddingService.js) to establish informational density.
2. **Calibrated 0.65 Threshold:** Tuned to allow short valid documents through to RAG while blocking out-of-scope schedules.
3. **Metadata Keyword Reranking:** Keyword hits from `key_criteria` provide immediate score boosts for short forms containing critical terms.