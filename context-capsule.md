# AI-Based Document Classification System — Complete Context Capsule
> **Target Audience:** AI Models, Developers, Architects, and Auditors  
> **System Purpose:** Automated RAG-Powered Legal Records Classification into Library of Virginia (LVA) General Schedule 17 (GS-17: Law Enforcement, Fire, and Emergency Services)  
> **Version:** 1.0 (Production Architecture)  
> **Workspace Root:** `d:\1) Internship\DOC-CLASS-CP-main - light theme`

---

## 1. Executive Summary & Core Mission

The **AI-Based Document Classification System** is an enterprise-grade, full-stack application engineered to solve the statutory records retention problem faced by state, county, and municipal government agencies.

### The Real-World Problem
Government agencies (police departments, sheriff's offices, 911 dispatch centers, fire & rescue squads) produce massive volumes of digital records every day:
- Felony and misdemeanor investigative case files
- Arrest records (adult, juvenile, deceased)
- 911 audio dispatch call logs and CAD reports
- Traffic crash reports (civilian vs. patrol vehicle)
- Body camera / surveillance footage logs
- Fire & rescue incident reports and EMS patient care records
- Animal control, dangerous dog registrations, pawnshop transactions, weapon inventories

Every document is legally governed by the **Library of Virginia (LVA) General Records Retention Schedules**. Each record category (known as a **Series**) defines:
1. **Statutory Retention Period** (e.g., *75 years after closed*, *100 years after birth*, *3 years after event*, *Permanent In Agency*).
2. **Mandated Disposal Method** (e.g., *Confidential Destruction*, *Non-confidential Destruction*, *Permanent Archives*).

Traditional keyword search and rule engines fail because real documents contain varied phrasing, OCR artifacts, unstructured narratives, synonyms, and complex legal distinctions (e.g., *Resolved vs. Unresolved*, *Used as Evidence vs. Not Used as Evidence*).

### The Solution Architecture
This system implements an advanced, hybrid **Semantic Vector Search + Heuristic Signal Reranking + Retrieval-Augmented Generation (RAG)** pipeline:
1. Multi-format ingestion with cloud buffer storage in **Cloudflare R2**.
2. Robust text extraction with **PDF-Parse**, **PDF.js fallback**, **Mammoth** (DOCX), **SheetJS/XLSX** (Excel), and **Tesseract OCR** with a persistent worker pool.
3. Domain-specific legal text cleaning, boilerplate removal, date normalization, and invisible artifact elimination.
4. Mathematical text embedding into a **768-dimensional vector space** using `@cf/baai/bge-base-en-v1.5` on **Cloudflare Workers AI**.
5. Ultra-fast Approximate Nearest Neighbor (ANN) search across all **88 official GS-17 record series** indexed in a **Zilliz Cloud / Milvus Vector Database**.
6. Deterministic **Heuristic Signal Detection & Edge Reranking** that analyzes legal case status, evidence markers, offense severity, and vehicle types to break vector score ties.
7. Similarity threshold gating ($\ge 0.65$) to prevent out-of-scope hallucinations.
8. LLM reasoning and selection using `@cf/meta/llama-3.1-8b-instruct` on **Cloudflare Workers AI**.
9. Composite confidence scoring combining mathematical cosine similarity with AI certainty linguistic analysis.
10. Dynamic, accessible web interface with glassmorphism styling and dark/light mode.

---

## 2. System Architecture & Layered Hierarchy

The application enforces a strict, unidirectional layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER (Browser)                           │
│  index.html (Semantic HTML5) • style.css (Glassmorphism) • theme.js     │
│  upload.js (Fetch API, Drag & Drop, Preview Drawer, State Management)   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP REST (multipart/form-data & JSON)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ROUTING LAYER (Express.js)                         │
│  routes/index.js (GET /, GET /api/health)                               │
│  routes/uploadRoutes.js (POST /api/v1/upload)                           │
│  routes/extractionRoutes.js (POST /api/v1/extract)                      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     MIDDLEWARE LAYER (Express.js)                       │
│  uploadMiddleware.js (Multer 2MB limit, MIME filter: PDF, DOCX, XLSX)   │
│  errorMiddleware.js (notFoundHandler, globalErrorHandler)               │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   CONTROLLER LAYER (Orchestration)                      │
│  controllers/uploadController.js (Pipeline orchestrator & Edge Reranker)│
│  controllers/extractionController.js (Text extraction endpoint handler) │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER (Business Logic)                      │
│  services/uploadService.js        • services/r2Service.js               │
│  services/extractionService.js    • services/ocrService.js              │
│  services/textCleaningService.js  • services/embeddingService.js        │
│  services/milvusService.js        • services/classificationService.js   │
└──────────────┬─────────────────────┬──────────────────────┬─────────────┘
               │                     │                      │
               ▼                     ▼                      ▼
┌────────────────────────┐┌────────────────────┐┌────────────────────────┐
│   Cloudflare R2 (S3)   ││  Zilliz / Milvus   ││  Cloudflare Workers AI │
│ Object Storage Buffer  ││  Vector Database   ││ Embeddings & Llama 3.1 │
└────────────────────────┘└────────────────────┘└────────────────────────┘
```

### Architectural Principles & Constraints
- **Unidirectional Flow:** `Route -> Middleware -> Controller -> Service -> External Systems/Utilities`.
- **No Controller Leaks:** Routes and Controllers never make direct Milvus or Workers AI API calls; all business logic lives strictly within Services.
- **Stateless Operation:** No persistent user session or database records are stored permanently in local uploads; all file payloads are buffered to R2 and can be pruned.
- **Fail-Safe Operation:** External service failures (e.g. OCR error, RAG timeout) degrade gracefully with informative fallback responses rather than terminating the process.

---

## 3. Technology Stack & Dependency Matrix

| Category | Component / Library | Version | Technical Purpose & Role |
| :--- | :--- | :--- | :--- |
| **Backend Runtime** | Node.js | v18+ (tested v24) | High-performance asynchronous JavaScript runtime |
| **Web Server** | Express.js | `^5.2.1` | REST API routing, middleware chaining, and HTTP management |
| **Object Storage** | `@aws-sdk/client-s3` | `^3.1081.0` | S3-compatible client for Cloudflare R2 cloud storage |
| **Vector Database** | `@zilliz/milvus2-sdk-node` | `^3.0.4` | Milvus/Zilliz Cloud client for 768-dim vector indexing & search |
| **Embeddings Model** | `@cf/baai/bge-base-en-v1.5` | Cloudflare AI | 768-dimensional dense vector embeddings |
| **LLM Classifier** | `@cf/meta/llama-3.1-8b-instruct` | Cloudflare AI | High-reasoning RAG document classification |
| **PDF Extraction** | `pdf-parse` | `^1.1.4` | Fast native PDF text extraction |
| **PDF Fallback** | `pdfjs-dist` | `^6.1.200` | Resilient legacy parser for corrupted xref / trailer tables |
| **DOCX Extraction** | `mammoth` | `^1.12.0` | XML-to-plain-text Word document extractor |
| **Spreadsheet Parsing**| `xlsx` (SheetJS) | `^0.18.5` | Multi-sheet Excel (XLSX, XLS) to CSV table converter |
| **OCR Engine** | `tesseract.js` | `^7.0.0` | Optical Character Recognition for image-only/scanned documents |
| **Canvas Renderer** | `@napi-rs/canvas` / `canvas`| `^3.2.3` | High-speed native canvas for PDF page image rendering |
| **Multipart Upload** | `multer` | `^2.2.0` | Memory buffer file upload validation and size limiting |
| **Configuration** | `dotenv` | `^17.4.2` | Environment variable loader and isolation |
| **HTTP Logging** | `morgan` | `^1.11.0` | HTTP request traffic logging for development |
| **CORS** | `cors` | `^2.8.6` | Cross-Origin Resource Sharing security middleware |
| **Frontend UI** | HTML5, Vanilla CSS3, Vanilla JS | Native | Ultra-responsive Glassmorphic UI with zero framework overhead |

---

## 4. End-to-End Execution Pipeline (Step-by-Step Data Flow)

When a user submits a document through the web interface, the following 11-stage pipeline executes:

```
[1. User File Drop] ──► [2. Multer Validation (2MB, MIME)] ──► [3. Cloudflare R2 Upload]
                                                                        │
┌───────────────────────────────────────────────────────────────────────┘
│
▼
[4. Multi-Format Text Extraction] ──► (Empty PDF text?) ──► [4b. Tesseract OCR Worker Pool]
│
▼
[5. Text Cleaning & Normalization] (Boilerplate removal, Date ISO 8601, Line deduplication)
│
▼
[6. 768-Dim Vector Embedding] (Cloudflare Workers AI: @cf/baai/bge-base-en-v1.5)
│
▼
[7. Milvus Vector Similarity Search] (Collection: gs17_records, Top-8 Candidates, Cosine Metric)
│
▼
[8. Heuristic Signal Detection & Edge Reranker] (Resolved vs Unresolved, Evidence, Severity)
│
▼
[9. Similarity Threshold Gate]
    ├── Top Score < 0.65 ──► Return out_of_scope: true (Bypass LLM, show warning)
    └── Top Score >= 0.65 ──► Proceed to Step 10
                                │
┌───────────────────────────────┘
▼
[10. RAG Prompting & LLM Classification] (Cloudflare Workers AI: Llama 3.1 8B Instruct)
│
▼
[11. Metadata Lookup & Response Assembly] (Fetch official series metadata, compute final confidence)
│
▼
[12. UI Rendering] (Classification Card, AI Reasoning, Top 3 Candidates, Extracted Text Preview)
```

---

## 5. Deep Dive: Document Storage & Multi-Format Ingestion

### 5.1 Cloudflare R2 Storage (`services/r2Service.js`)
- Files are buffered in memory using `multer.memoryStorage()` to avoid writing sensitive documents to local disk.
- Uploaded files are immediately pushed to **Cloudflare R2** (an S3-compatible, zero-egress cloud object store).
- Object Key format: `${Date.now()}-${sanitizedBaseName}${ext}`.
- Sanitization replaces all non-alphanumeric characters with hyphens to guarantee valid URI and S3 compatibility.

### 5.2 Multi-Engine Text Extraction (`services/extractionService.js`)
The system supports four major document formats with automatic fallback hierarchies:

1. **PDF (`.pdf`):**
   - Primary: `pdf-parse` extracts plain text directly from the PDF document streams.
   - Secondary (Corrupt / Broken PDF Fallback): If `pdf-parse` encounters trailer errors, bad xref tables, or invalid syntax, `extractionService.js` automatically routes the buffer to `pdfjs-dist` (PDF.js legacy engine), which reconstructs text streams page by page.
   - Tertiary (Scanned / Image-Only PDF Fallback): If the extracted text contains zero characters or fewer than 10 characters, the buffer is routed to `ocrService.js`.
2. **Microsoft Word (`.docx`):**
   - Handled via `mammoth.extractRawText()`, extracting clean document text while ignoring complex formatting styles.
3. **Microsoft Excel (`.xlsx`, `.xls`):**
   - Handled via `xlsx` (SheetJS). Iterates through every workbook sheet and converts cell grids into structured CSV text (`[Sheet: SheetName]\n...`).

---

## 6. Deep Dive: Persistent OCR Engine (`services/ocrService.js`)

For scanned records, faxes, or photo-based PDFs, the system features a dedicated OCR subsystem:

```
                      [ Incoming PDF Buffer ]
                                 │
                                 ▼
                     [ PDF.js Page Evaluator ]
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
[ Embedded Text Layer Found? ]                 [ No Embedded Text Found ]
         │ (Length >= 10 chars)                          │ (Scanned Image Page)
         ▼                                               ▼
[ Return Embedded Page Text ]                  [ Acquire Worker Slot from Pool ]
                                                         │
                                                         ▼
                                               [ Render Page to Canvas @ 2.0x ]
                                                         │
                                                         ▼
                                               [ Tesseract eng Recognition ]
                                                         │
                                                         ▼
                                               [ Release Slot to Worker Pool ]
```

### Key Technical Specs:
- **Worker Pool Architecture:** Initializes a pool of **3 persistent Tesseract workers** at application startup.
- **Concurrency & Queuing:** Uses `acquireSlot()` and `releaseSlot()` with a FIFO promise queue to prevent worker thread starvation or memory leaks.
- **Selective Page-Level OCR:** Evaluates each PDF page individually. If a page already contains embedded selectable text ($\ge 10$ characters), OCR is skipped for that page, running OCR *only* on image-only pages.
- **High-DPI Rendering:** Uses `@napi-rs/canvas` to render PDF pages at a `2.0x` scaling factor, dramatically improving character recognition accuracy on small print and faxes.

---

## 7. Deep Dive: Text Cleaning & Normalization Pipeline (`services/textCleaningService.js`)

Extracted text from real-world documents contains noise that degrades vector similarity and consumes unnecessary LLM token windows. The text cleaning service applies a 7-stage deterministic transformation pipeline:

1. **Invisible Character Elimination:** Strips Byte Order Marks (`\uFEFF`) and zero-width spaces (`\u200B-\u200D`, `\u2060`).
2. **Line Ending Normalization:** Converts all `\r\n` and `\r` into uniform `\n`.
3. **Legal & Institutional Boilerplate Stripping:**
   - Strips Virginia Code citations (e.g., `COV 15.2-1722`).
   - Strips Code of Federal Regulations headers (e.g., `28 CFR 20.37`).
   - Strips distribution lines, signature blocks, and generic approval footers (`Signature: ... Date:`).
4. **ISO 8601 Date Normalization:**
   - `"March 15, 2023"` $\rightarrow$ `"2023-03-15"`
   - `"15 March 2023"` $\rightarrow$ `"2023-03-15"`
   - `"03/15/2023"` $\rightarrow$ `"2023-03-15"`
5. **Page Number & Artifact Removal:**
   - Removes standalone page markers (`Page 1 of 4`, `[Page 2]`, `| 3 |`).
   - Removes decorative ASCII divider lines (`===`, `---`, `___`).
6. **Organizational & Legal Abbreviation Expansion:**
   - `Dept.` $\rightarrow$ `Department`, `Admin.` $\rightarrow$ `Administration`, `Div.` $\rightarrow$ `Division`
   - `v.` $\rightarrow$ `versus`, `et al.` $\rightarrow$ `and others`, `e.g.` $\rightarrow$ `for example`
7. **Line Deduplication & Spacing Normalization:**
   - Removes duplicate identical lines (common in repeated page headers).
   - Collapses consecutive blank lines into a single blank line.
   - Trims leading/trailing whitespace on every line while preserving table/tab structures.

---

## 8. Deep Dive: Semantic Vector Embedding Engine (`services/embeddingService.js`)

- **Model:** `@cf/baai/bge-base-en-v1.5` hosted on **Cloudflare Workers AI**.
- **Vector Dimensionality:** Exactly **768 floating-point numbers** ($D = 768$).
- **Embedding Generation:** Input text is sent via HTTPS REST API to Cloudflare Workers AI.
- **Classification Context Framing:**  
  When `useContextEmbedding` is enabled, the text is wrapped in a specialized domain framing prompt before embedding:
  ```text
  You are analyzing a government/organizational document for records retention classification.
  Focus on: document type, legal purpose, case status, subject matter, and record lifecycle.
  Document text:
  """
  <Cleaned Document Text>
  """
  Analyze this document carefully.
  ```
  *Why this matters:* Context framing establishes an informational baseline, ensuring that short documents (e.g., a 10-word impound slip) embed closely with dense legal record series descriptions rather than being skewed by brevity.

---

## 9. Deep Dive: Milvus / Zilliz Cloud Vector Search (`services/milvusService.js`)

### 9.1 Collection Schema (`gs17_records`)
The vector collection is structured with strict typing:

| Field Name | Type | Key / Index | Description |
| :--- | :--- | :--- | :--- |
| `id` | `DataType.Int64` | Primary Key (autoID: true) | Unique internal Milvus record identifier |
| `schedule_number` | `DataType.VarChar(64)` | Standard Field | `"GS-17"` |
| `schedule_title` | `DataType.VarChar(2048)`| Standard Field | `"Law Enforcement, Fire and Emergency Services"` |
| `series_number` | `DataType.VarChar(64)` | Filterable Field | Unique Series Number (e.g., `"100713"`, `"100812"`) |
| `series_title` | `DataType.VarChar(2048)`| Standard Field | Official Series Name |
| `series_description` | `DataType.VarChar(2048)`| Standard Field | Detailed statutory description of covered records |
| `series_retention_period` | `DataType.VarChar(256)` | Standard Field | Required retention time |
| `series_disposition_method`| `DataType.VarChar(256)` | Standard Field | Legal disposal method |
| `text_to_embed` | `DataType.VarChar(2048)`| Enriched Field | Rich semantic context string used to generate record vector |
| `embedding` | `DataType.FloatVector(768)`| `AUTOINDEX` (COSINE) | 768-dimensional float embedding vector |

### 9.2 Search Execution
- **Distance Metric:** `MetricType.COSINE`.
- **Search Parameters:** `nprobe: 32`, `limit: 8`, `consistency_level: 'Strong'`.
- The search returns the top 8 candidates, each with an exact cosine similarity score ranging from `0.000` to `1.000`.

---

## 10. Deep Dive: Heuristic Signal Detection & Edge Reranking Engine (`controllers/uploadController.js`)

In government records, two distinct record series often share 95% identical terminology while having opposite legal retention rules (e.g., *Series 200146: Less Serious Offenses - Resolved [30 yrs]* vs. *Series 200147: Less Serious Offenses - Unresolved [50 yrs]*).

To ensure 100% precision, `uploadController.js` executes a deterministic **Edge Reranker** when candidate vector similarity scores are within a tight margin ($\le 0.015$):

```
                        [ Top 8 Milvus Candidates ]
                                     │
                                     ▼
             [ Score Gap Between Candidate #1 and #2 <= 0.015? ]
                                     │
                     ┌───────────────┴───────────────┐
                     ▼ YES                           ▼ NO
        [ Run Signal Detection ]             [ Keep Raw Milvus Ranking ]
                     │
        ┌────────────┴───────────────────────────────────────────┐
        ▼ Case Status: Resolved vs Unresolved (+/- 0.025)        ▼ Offense Severity: Serious vs Minor (+/- 0.015)
        ▼ Evidence Status: Used vs Not Used (+/- 0.015)          ▼ Vehicle: Citizen Crash vs Police Crash (+0.012)
        ▼ Retention Year Matches in Document Text (+0.012)
                     │
                     ▼
        [ Re-sort Top 5 Window by Adjusted Score ]
                     │
                     ▼
        [ Final Reranked Top Candidates Passed to RAG ]
```

### Signal Boost Rules:
1. **Case Resolution Status:**
   - Detects: *closed, resolved, convicted, guilty plea, sentenced, acquitted, located safely*.
   - Detects: *unresolved, open case, active investigation, unsolved, cold case, suspect at large*.
   - Boosts matching series by `+0.025` and penalizes opposing series by `-0.025`.
2. **Evidence Utilization:**
   - Detects: *used as evidence, citation issued, civil penalty*.
   - Detects: *not used as evidence, no summons issued*.
   - Boost: `+0.015` / `-0.015`.
3. **Offense Severity:**
   - Detects violent felonies (*homicide, murder, kidnapping, armed robbery, rape*) vs. minor infractions (*curfew, loitering, trespassing, simple assault*).
   - Boost: `+0.015` / `-0.015`.
4. **Traffic Accident Entity:**
   - Detects civilian vehicle (*citizen vehicles, civilian vehicle, driver:*) vs. patrol vehicle (*patrol unit, law enforcement vehicle, officer involved*).
   - Boost: `+0.012` / `-0.010`.
5. **Retention Period Mention:**
   - Extracts explicit retention durations in text (*"3 years"*, *"10 years"*) and matches them against series retention rules (`+0.012`).

---

## 11. Deep Dive: Similarity Gating & Out-of-Scope Protection

- **Gate Threshold:** `MIN_SIMILARITY_THRESHOLD = 0.65`.
- **Purpose:** Prevents the LLM from hallucinating a GS-17 classification for documents that belong to entirely different schedules (e.g., GS-15 County Financial Audits, GS-14 Personnel Payroll, or non-governmental documents).
- **Behavior:**
  - If the top candidate similarity score is $< 0.65$:
    - The controller sets `out_of_scope: true`.
    - Skips LLM classification entirely.
    - Returns the top 3 nearest candidates for informational reference only.
    - The frontend displays an alert banner explaining that the document is outside GS-17 scope.
  - If the top candidate similarity score is $\ge 0.65$:
    - The document proceeds to RAG classification.

---

## 12. Deep Dive: RAG Classification & LLM Inference Pipeline (`services/classificationService.js`)

### 12.1 LLM Configuration
- **Model:** `@cf/meta/llama-3.1-8b-instruct` on **Cloudflare Workers AI**.
- **Inference Temperature:** `0.1` (ensures near-deterministic, fact-grounded responses).

### 12.2 The Prompt Contract
The service constructs a strict system and user prompt pair:

```text
SYSTEM PROMPT:
You are an expert records management specialist for state and local government records according to the Library of Virginia (LVA) Record Management Schedule.
Your task is to analyze document content and select the single best matching record series from the provided candidate series.

CRITICAL RULES:
1. STRICT CANDIDATE SELECTION: You MUST select your answer ONLY from the provided candidate series numbers [100713, 100771, ...]. Never select a series number outside this list.
2. STRICT FACTUAL GROUNDING: Base your explanation STRICTLY on explicit facts, keywords, and topics directly present in the document content. DO NOT invent, extrapolate, or hallucinate.
3. CASE RESOLUTION STATUS (RESOLVED vs. UNRESOLVED):
   - If the document indicates that the case is RESOLVED/CLOSED, choose the RESOLVED series.
   - If the document indicates that the case is OPEN/ACTIVE/UNRESOLVED, choose the UNRESOLVED series.
4. NO FORCED MATCHING: If no clear match exists, select the highest-similarity candidate and note that the match is weak.

USER PROMPT:
Document Content:
"""
<Cleaned Document Text (up to 4000 chars)>
"""

Candidate Record Series (ranked by semantic similarity):
1. Series [100713]: "Arrest Files: Adult"
   - Retention Period: "100 Years after birth"
   - Disposition Method: "Confidential Destruction"
   - Description: "This series documents the arrest history of adult individuals..."
   - Similarity Score: 0.8842

Respond ONLY with a JSON object:
{
  "selected_series_number": "<series_number>",
  "reasoning": "<1-2 sentence explanation>"
}
```

### 12.3 JSON Sanitization & Candidate Validation
- The service strips markdown code fences (` ```json ... ``` `).
- Extracts the outermost `{ ... }` JSON block.
- Validates that `selected_series_number` exists and strictly matches one of the candidate series.
- Fallback: If the model returns an invalid or non-candidate series number, the system logs a warning and automatically falls back to Candidate #1 from vector search.

---

## 13. Deep Dive: Dual Metric Confidence Framework

The system cleanly distinguishes between **Mathematical Similarity** and **Final Classification Confidence**:

```
[ Milvus Vector Search ] ──► Base Similarity Score (e.g. 0.8400)
                                       │
                                       ▼ (+)
[ LLM Reasoning Text ]   ──► Keyword Certainty Analysis ──► AI Boost Applied (+0.08 to +0.12)
                                       │
                                       ▼ (=)
                             Final Confidence (e.g. 0.9500 / 95.0%)
```

### 13.1 Mathematical Similarity Score (`similarity_score`)
- Derived directly from the Cosine distance in Milvus (`0.000` to `1.000`).
- Measures the purely mathematical alignment between the document vector and the series description vector.

### 13.2 Composite Confidence Score (`confidence`)
Calculated via a deterministic formula in `classificationService.js`:

$$\text{Final Confidence} = \min\Big(0.95,\; \max\big(\text{Base Similarity},\; \text{Base Similarity} + \text{AI Boost}\big)\Big)$$

1. **Linguistic Keyword Scanner:**
   - **`HIGH` Certainty Keywords:** *"exactly"*, *"perfect"*, *"clearly"*, *"matches"*, *"definitely"*, *"precisely"*, *"unambiguously"*, *"direct match"*, *"best match"*, *"exact match"*.
   - **`MEDIUM` Certainty Keywords:** *"aligns"*, *"fits"*, *"good"*, *"reasonable"*, *"appropriate"*, *"consistent"*, *"appears"*, *"seems"*.
   - **`LOW` Certainty Keywords:** *"could"*, *"might"*, *"possibly"*, *"similar"*, *"suggests"*, *"indicates"*, *"may"*, *"unclear"*, *"ambiguous"*.
2. **Dynamic Boost Calculation:**
   - If AI Certainty is `HIGH` and Base Similarity $\ge 0.65$:
     $$\text{Boost} = 0.08 + \min\Big(0.04,\; (\text{Similarity} - 0.65) \times 0.2\Big)$$
     *(Boost ranges smoothly from $+0.0800$ to $+0.1200$)*
   - If AI Certainty is `MEDIUM` or `LOW`: $\text{Boost} = 0.0000$.
3. **Core Guarantees:**
   - **Non-Penalizing:** Final confidence is guaranteed never to be lower than the base similarity score.
   - **0.95 Ceiling Cap:** Confidence is strictly capped at `0.95` (95%) to reflect that legal records classification always preserves headroom for final human administrative verification.

---

## 14. Deep Dive: Official Metadata Retrieval & Fallback

Once the LLM selects the `selected_series_number`, the system retrieves the complete official metadata via `milvusService.getFullRecord()`:
1. **Primary Lookup:** Queries the `gs17_records` Milvus collection by `series_number`.
2. **Resilience Fallback:** If Milvus connectivity is degraded, the service falls back to the local `gs-17.json` dataset.
3. **Metadata Returned:**
   - `schedule_number` (e.g., `"GS-17"`)
   - `schedule_title` (`"Law Enforcement, Fire and Emergency Services"`)
   - `series_number` (e.g., `"100812"`)
   - `series_title` (`"Abandoned/Impounded Vehicles"`)
   - `series_description` (Full statutory description)
   - `retention_period` (e.g., `"3 years after vehicle sold or no longer in use"`)
   - `disposition_method` (`"Non-confidential Destruction"`)

---

## 15. REST API Specifications

### 15.1 `POST /api/v1/upload`
Orchestrates document upload, extraction, semantic search, RAG classification, and metadata assembly.

- **Content-Type:** `multipart/form-data`
- **Body:** `document: <File Buffer>` (Max 2 MB, `.pdf`, `.docx`, `.xlsx`, `.xls`)
- **Success Response (`200 OK`):**
```json
{
  "success": true,
  "message": "File uploaded successfully.",
  "data": {
    "filename": "1771586390000-fairfax-tow-slip.pdf",
    "originalName": "fairfax-tow-slip.pdf",
    "mimeType": "application/pdf",
    "size": 45210
  },
  "top_3_candidates": [
    {
      "rank": 1,
      "series_number": "100812",
      "schedule_title": "Law Enforcement, Fire and Emergency Services",
      "series_title": "Abandoned/Impounded Vehicles",
      "retention_period": "3 years after vehicle sold or no longer in use",
      "disposition_method": "Non-confidential Destruction",
      "description": "This series documents the identification, retrieval...",
      "similarity_score": 0.8824
    },
    {
      "rank": 2,
      "series_number": "100805",
      "schedule_title": "Law Enforcement, Fire and Emergency Services",
      "series_title": "Towed Vehicle Files",
      "retention_period": "3 years after event",
      "disposition_method": "Non-confidential Destruction",
      "description": "This series documents law enforcement's towing actions...",
      "similarity_score": 0.7915
    },
    {
      "rank": 3,
      "series_number": "000347",
      "schedule_title": "Law Enforcement, Fire and Emergency Services",
      "series_title": "Towing Company Records",
      "retention_period": "3 years after event",
      "disposition_method": "Non-confidential Destruction",
      "description": "This series documents the registration of towing companies...",
      "similarity_score": 0.7102
    }
  ],
  "classification": {
    "selected_series_number": "100812",
    "ai_reasoning": "The document is a vehicle tow and impound inventory slip containing VIN, make, model, and owner disposal release authorization, matching Series 100812 exactly.",
    "confidence": 0.95
  },
  "selected_record_metadata": {
    "schedule_number": "GS-17",
    "schedule_title": "Law Enforcement, Fire and Emergency Services",
    "series_number": "100812",
    "series_title": "Abandoned/Impounded Vehicles",
    "series_description": "This series documents the identification, retrieval, processing, storage, return, or disposal/auction of abandoned or impounded vehicles.",
    "retention_period": "3 years after vehicle sold or no longer in use",
    "disposition_method": "Non-confidential Destruction"
  },
  "out_of_scope": false,
  "extraction": {
    "fileType": "pdf",
    "text": "FAIRFAX COUNTY POLICE DEPARTMENT\nVEHICLE IMPOUND REPORT..."
  }
}
```

### 15.2 `POST /api/v1/extract`
Direct text extraction and cleaning endpoint for integration testing or previewing.
- **Content-Type:** `application/json`
- **Body:** `{ "r2Key": "1771586390000-sample-report.pdf" }`
- **Response (`200 OK`):**
```json
{
  "success": true,
  "fileType": "pdf",
  "text": "Cleaned document text content..."
}
```

### 15.3 `GET /api/health`
- **Response (`200 OK`):**
```json
{
  "success": true,
  "project": "AI-Based Document Classification System",
  "status": "Running"
}
```

---

## 16. Frontend Client & UI Architecture

- **Path:** `backend/views/index.html`, `backend/public/css/style.css`, `backend/public/js/`
- **Design Language:** Modern Glassmorphism with deep space backgrounds, subtle borders (`rgba(255, 255, 255, 0.08)`), dynamic backdrop blur (`blur(16px)`), and curated typography (Inter/System fonts).
- **Theme Engine (`public/js/theme.js`):**
  - Instant theme switching between **Dark Mode** and **Light Mode**.
  - Persisted in `localStorage('doc-class-theme')`.
  - Head script pre-renders theme state to prevent flash of unstyled content (FOUC).
- **Upload & Interactive Logic (`public/js/upload.js`):**
  - Native drag-and-drop listener on `#drop-zone`.
  - Real-time file type validation and size formatting.
  - Interactive file selection card with quick remove (`#clear-btn`).
  - Animated spinner button during async classification.
  - Dynamic result section injection:
    - **Classification Header & Confidence Badge**
    - **Metadata Grid Card** (Schedule, Series Number, Series Title, Retention Period, Disposition Method, Description)
    - **AI Reasoning Card**
    - **Top 3 Candidate Matches Breakdown** (with similarity percentage tags)
    - **Collapsible Extracted Text Preview Drawer** (enabled via `ENABLE_EXTRACTION_PREVIEW=true`)
    - **Out-of-Scope Warning Banner** (when top score $< 0.65$).

---

## 17. Diagnostic, Benchmarking & Ingestion Tooling

The repository includes a suite of command-line diagnostic and maintenance scripts in `backend/scripts/`:

### 1. `enrich-and-reembed-all.js`
- **Purpose:** Injects rich semantic descriptions into `text_to_embed` for all 88 GS-17 series and re-embeds them into the Milvus collection.
- **Run Command:** `node backend/scripts/enrich-and-reembed-all.js`

### 2. `diagnose-milvus.js`
- **Purpose:** Comprehensive diagnostic health check for Milvus and vector search:
  - Validates all environment keys.
  - Verifies cluster connection and collection status.
  - Checks for missing series between `gs-17.json` and Milvus.
  - Detects zero-vectors and calculates embedding L2 norm statistics.
  - Executes live end-to-end vector search benchmarks against sample documents.
- **Run Command:** `node backend/scripts/diagnose-milvus.js`

### 3. `benchmark-all-88.js`
- **Purpose:** Executes automated retrieval benchmarks across all 88 record categories to evaluate Top-1, Top-3, and Top-5 retrieval accuracy.
- **Run Command:** `node backend/scripts/benchmark-all-88.js`

---

## 18. Environment Variables & Security Conventions

All sensitive secrets are isolated in `backend/.env` (and documented in `backend/.env.example`):

```ini
# Server
PORT=3000
NODE_ENV=development
ENABLE_EXTRACTION_PREVIEW=true
USE_CONTEXT_EMBEDDING=false

# Cloudflare R2 (Object Storage)
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_r2_bucket_name
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com

# Zilliz Cloud / Milvus Vector Database
MILVUS_ADDRESS=https://in03-xxxxxxxx.serverless.gcp-us-west1.zillizcloud.com
MILVUS_TOKEN=your_zilliz_api_token

# Cloudflare Workers AI (Embeddings & LLM)
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
```

### Security Best Practices:
- Secrets are never hardcoded in source code or logged to terminal outputs.
- Uploaded files are restricted to max 2 MB and strictly validated against MIME types and extensions.
- Client output is strictly escaped via `escapeHTML()` to prevent XSS.

---

## 19. Project File System & Codebase Reference Map

```text
DOC-CLASS-CP-main - light theme/
│
├── gs-17.json                           # Source dataset containing all 88 GS-17 record definitions
├── context-capsule.md                   # This comprehensive master context capsule
├── how-it-works.md                      # Architecture & workflow walkthrough
├── PROJECT_SPECIFICATION.md             # Functional requirements & project specifications
├── ARCHITECTURE.md                      # Software architecture principles & module rules
├── AI_RULES.md                          # AI pair programming guidelines & standards
│
└── backend/
    ├── server.js                        # Express server entry point & middleware mounting
    ├── package.json                     # Node.js dependencies & scripts
    ├── .env                             # Active environment configuration & credentials
    ├── .env.example                     # Environment template
    │
    ├── config/
    │   ├── app.config.js                # Centralized configuration validator
    │   └── constants.js                 # Upload limits, MIME types, and constants
    │
    ├── middleware/
    │   ├── uploadMiddleware.js          # Multer memory upload handler with MIME validation
    │   └── errorMiddleware.js           # 404 handler and global JSON error handler
    │
    ├── routes/
    │   ├── index.js                     # Root UI route (GET /) & Health check (GET /api/health)
    │   ├── uploadRoutes.js              # Upload API route (POST /api/v1/upload)
    │   └── extractionRoutes.js          # Extraction API route (POST /api/v1/extract)
    │
    ├── controllers/
    │   ├── uploadController.js          # Pipeline orchestrator, signal detector, & edge reranker
    │   └── extractionController.js      # Text extraction endpoint controller
    │
    ├── services/
    │   ├── uploadService.js             # Upload validation helper
    │   ├── r2Service.js                 # Cloudflare R2 object upload & download operations
    │   ├── extractionService.js         # Multi-format text extraction router (PDF, DOCX, XLSX)
    │   ├── ocrService.js                # Persistent Tesseract OCR worker pool with canvas
    │   ├── textCleaningService.js       # Text normalization, boilerplate removal & date cleaner
    │   ├── embeddingService.js          # Cloudflare BGE-base 768-dim vector embedding generator
    │   ├── milvusService.js             # Zilliz/Milvus connection, collection setup, & search
    │   └── classificationService.js     # Cloudflare Llama 3.1 8B RAG classifier & confidence booster
    │
    ├── utils/
    │   └── logger.js                    # Standardized colorized console logger
    │
    ├── views/
    │   └── index.html                   # Main single-page web interface
    │
    ├── public/
    │   ├── css/
    │   │   └── style.css                # Glassmorphism design system & dark/light theme CSS
    │   └── js/
    │       ├── theme.js                 # Theme switcher & localStorage persistence
    │       └── upload.js                # Frontend drag & drop, fetch caller, & DOM renderer
    │
    └── scripts/
        ├── enrich-and-reembed-all.js    # Batch semantic enrichment & vector population script
        ├── diagnose-milvus.js           # Milvus connection, vector health, & live search tests
        ├── benchmark-all-88.js          # Comprehensive 88-series classification benchmark
        ├── reembed-series.js            # Targeted single-series re-embedding script
        └── analyze-embeddings.js        # Vector distribution & similarity analyzer
```

---

## 20. Quick Reference for AI Models

When processing, modifying, or extending this codebase:
1. **Always preserve the layered architecture:** `Route -> Middleware -> Controller -> Service -> External API`.
2. **Never make direct Milvus or AI calls in Routes or Controllers.**
3. **Embedding dimension is fixed at 768** (`@cf/baai/bge-base-en-v1.5`).
4. **LLM outputs must always be validated against candidate series numbers.**
5. **Always maintain the 0.95 confidence ceiling cap and non-penalizing guarantee.**
6. **Ensure zero frontend framework dependencies** (keep `index.html`, `style.css`, `upload.js`, `theme.js` clean and vanilla).
