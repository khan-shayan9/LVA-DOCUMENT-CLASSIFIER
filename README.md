# LVA Document Classifier

AI-powered RAG system that classifies government records into their official **Library of Virginia (LVA) General Schedule** retention series — using semantic vector search and an LLM instead of manual lookup or keyword matching.

Upload a PDF, Word, or Excel document and get back the matching record series, its statutory retention period, mandated disposition method, and the AI's reasoning for the match.

---

## Why

State and municipal agencies (police, fire, dispatch, records offices) generate huge volumes of digital records daily, each governed by legally mandated retention rules. Manually looking up the correct schedule series for every document is slow and error-prone — synonyms, unstructured narratives, and subtle legal distinctions (e.g. *resolved vs. unresolved*, *evidence vs. non-evidence*) make simple keyword search unreliable. This project automates that lookup with a retrieval-augmented generation pipeline that grounds every AI decision in real statutory metadata, not a hallucinated guess.

## How it works

1. **Upload** — PDF, DOCX, XLSX/XLS (max 2 MB), validated and archived to Cloudflare R2.
2. **Extract** — format-specific text extraction (`pdf-parse`, Mammoth, SheetJS), with an OCR fallback (Tesseract + PDF.js + Canvas) for scanned/image-only PDFs.
3. **Clean** — a 7-stage normalization pipeline strips boilerplate, noise, and formatting artifacts before anything is embedded.
4. **Embed & search** — the cleaned text is embedded (768-dim, Cloudflare Workers AI `bge-base-en-v1.5`) and matched via cosine similarity against a Zilliz Cloud / Milvus collection of **119 record series** across the GS-02, GS-14, and GS-17 schedules.
5. **Rerank** — a metadata-driven keyword/IDF reranker boosts candidates that share statutory key-criteria terms with the document, resolving near-ties between confusable series.
6. **Gate** — if the top match scores below a similarity threshold, the document is flagged out-of-scope and classification is skipped (no LLM call, no guessing).
7. **Classify** — the top candidates are passed to an LLM (Llama 3.1 8B Instruct, Cloudflare Workers AI) constrained to select only from the retrieved candidates and ground its reasoning in the document text.
8. **Respond** — the selected series' full statutory metadata, a confidence score, and the AI's reasoning are returned to the frontend.

Full architectural detail (data flow diagrams, prompt design, confidence formula, security hardening) is in [`workflow.md`](workflow.md).

## Tech stack

| Layer | Technology |
| :--- | :--- |
| Backend | Node.js ≥22.13, Express.js |
| Object storage | Cloudflare R2 (S3-compatible) |
| Text extraction | pdf-parse, PDF.js, Mammoth, SheetJS, Tesseract.js OCR |
| Vector DB | Zilliz Cloud / Milvus (cosine similarity, AUTOINDEX) |
| Embeddings | Cloudflare Workers AI — `bge-base-en-v1.5` (768-dim) |
| Classification | Cloudflare Workers AI — `Llama 3.1 8B Instruct` |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Security | `express-rate-limit`, locked-down CORS, npm-audited dependencies |

## Project structure

```
backend/
├── config/        # env var loading, upload/rate-limit constants
├── middleware/     # upload validation, rate limiting, error handling
├── routes/         # thin route definitions
├── controllers/     # request orchestration
├── services/         # business logic — R2, extraction, OCR, cleaning,
│                      embedding, Milvus, classification, reranking
├── data/schedules/    # GS-02 / GS-14 / GS-17 record series datasets (JSON)
├── scripts/           # ingestion, benchmarking, and validation scripts
├── public/, views/    # static frontend
└── server.js
```

See [`2.ARCHITECTURE.md`](2.ARCHITECTURE.md) for the full layered-architecture spec.

## Getting started

**Prerequisites:** Node.js ≥22.13, a Cloudflare account (R2 + Workers AI), and a Zilliz Cloud (Milvus) cluster.

```bash
cd backend
npm install
cp .env.example .env   # fill in your R2, Milvus, and Cloudflare credentials
npm start
```

The app serves both the API and the frontend at `http://localhost:3000`.

### Environment variables

See [`.env.example`](backend/.env.example) for the full list. At minimum you need R2 storage credentials, a Milvus/Zilliz connection, and a Cloudflare Workers AI API token. `ENABLE_EXTRACTION_PREVIEW` and `CORS_ORIGIN` should stay unset/`false` in any public deployment — see **Security** below.

## API

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/upload` | Upload a document, run the full pipeline, return classification |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/v1/extract` | Debug-only text extraction by R2 key — disabled unless `ENABLE_EXTRACTION_PREVIEW=true` |

All responses follow `{ success, message, data }` on success and `{ success: false, message }` on failure.

## Security

This was hardened for public deployment, not just local dev:

- **CORS** is closed by default (no cross-origin access) unless `CORS_ORIGIN` is explicitly set.
- **Rate limiting** on `/upload` and `/extract` protects the paid Cloudflare/R2/Milvus usage from abuse.
- The debug extraction endpoint is **disabled by default** — it previously allowed reading any uploaded file's text with no ownership check.
- Dependencies are kept patched via `npm audit`; the one known unresolved advisory (SheetJS/`xlsx`, no upstream npm fix) is a documented, accepted risk given the narrow way the library is used (text-only cell reads).

## Documentation

- [`1.PROJECT_SPECIFICATION.md`](1.PROJECT_SPECIFICATION.md) — functional & non-functional requirements
- [`2.ARCHITECTURE.md`](2.ARCHITECTURE.md) — layered architecture spec
- [`workflow.md`](workflow.md) — full pipeline, RAG/confidence design, and security/performance deep dive

## Author

Built by [Shayan Khan](https://github.com/khan-shayan9) as part of the SPS Summer Internship program.
