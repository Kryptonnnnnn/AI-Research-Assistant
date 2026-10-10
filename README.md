# AI Research Assistant (RAG)

A full-stack research workspace: upload PDFs, DOCX, TXT and Markdown, organise them into collections, and ask questions that are answered **only from your documents, with verifiable citations**. Built with Next.js, FastAPI, PostgreSQL + pgvector, local Sentence-Transformers embeddings, and pluggable LLMs (Groq, Ollama, or an offline mock).

## Live demo
- App: https://ai-research-assistant-beta-flame.vercel.app (Vercel → proxies `/api/*` to the API)
- API docs: https://ai-research-assistant-api-gwcu.onrender.com/docs · readiness: `/ready`
- Free tiers: the API sleeps after 15 min idle (first request ≈ 1 min). Production runs **semantic** retrieval (fastembed / all-MiniLM-L6-v2) and Groq `openai/gpt-oss-120b`; `/ready` reports the active provider, retrieval mode, storage backend and any warnings (never secrets).

## Features
- **Auth & isolation** — Argon2id, revocable server-side sessions (httpOnly cookie), per-user data isolation enforced in every query and covered by tests, rate limits.
- **Ingestion pipeline** — validated uploads (extension, MIME, magic bytes, size), SHA-256 duplicate detection, background jobs with progress, retries, stale-job recovery, readable errors for scanned/corrupt/empty files. *No OCR.*
- **RAG** — token-aware overlapping chunks (default 800/120), hybrid retrieval (pgvector cosine + PostgreSQL full-text), threshold, dedupe, multi-document balancing, context budget, "insufficient evidence" instead of guessing, prompt-injection-aware prompting.
- **Citations & evidence viewer** — `[S1]` markers validated against retrieved chunks (invented ids are stripped); click a citation to see the exact excerpt, page, scores and open the document at that page. Supported claims / interpretation / insufficient evidence are visually distinguished.
- **Chat** — streaming, stop, regenerate, retry, copy, follow-up suggestions, persistent history with search/rename/delete, Markdown export, Q&A / research-brief / multi-document-synthesis modes, scope = all docs / a collection / selected docs.
- **Research tools** — summaries, question generation, key-finding extraction, document comparison, semantic search, saved notes (Markdown export), collections.
- **Dashboard & settings** — real metrics from the database, provider/model/retrieval settings per user, connection test, health, processing error log, light/dark theme.
- **Providers** — Groq (hosted), Ollama (local), mock (deterministic tests). Model ids come from environment variables — none are hard-coded.

Architecture notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Security: [`SECURITY.md`](SECURITY.md) · Deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Screenshots
| Dashboard | Chat with citations |
|---|---|
| ![Dashboard](docs/screenshots/desktop-dashboard.png) | ![Chat](docs/screenshots/desktop-chat.png) |
| **Evidence panel** (exact excerpt, page, scores) | **Documents** |
| ![Evidence](docs/screenshots/desktop-evidence.png) | ![Documents](docs/screenshots/desktop-documents.png) |
| **Research tools** | **Mobile** |
| ![Research](docs/screenshots/desktop-research.png) | ![Mobile chat](docs/screenshots/mobile-chat.png) |

## Repository layout
```
backend/    FastAPI app (app/{api,core,db,models,schemas,services,repositories,rag,ingestion,embeddings,llm,storage,jobs,vectorstore}),
            migrations/ (Alembic), tests/, scripts/seed_demo.py, samples/
frontend/   Next.js app (src/{app,components,features,hooks,lib,types}, tests/ incl. Playwright e2e)
docs/       architecture + deployment      docker-compose.yml   PostgreSQL+pgvector (and optional app containers)
render.yaml Render blueprint               .env.example         every setting, documented
```

## Quick start (local)
Requirements: Python 3.11+, Node 20+ (22 tested), Docker (optional, for PostgreSQL).

### 1. Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt                          # API + tests
pip install -r requirements-ml.txt                           # local Sentence-Transformers embeddings (large: PyTorch)
cp ../.env.example .env                                      # then edit (see below)
alembic upgrade head                                         # create the schema
uvicorn app.main:app --reload --port 8000                    # API docs: http://localhost:8000/docs
```
Pick a setup in `backend/.env`:

| Goal | Settings |
|---|---|
| **Zero-install demo** (no Ollama, no model download) | `EMBEDDING_PROVIDER=hash`, `LLM_PROVIDER=mock`, `RETRIEVAL_SCORE_THRESHOLD=0.1` |
| **Local & private** | `EMBEDDING_PROVIDER=sentence-transformers`, `LLM_PROVIDER=ollama`, `LLM_MODEL=<name from ollama list>` |
| **Hosted LLM** | `LLM_PROVIDER=groq`, `GROQ_API_KEY=…`, `LLM_MODEL=<current model id from console.groq.com>` |

Optional PostgreSQL + pgvector (recommended; SQLite is the default and needs nothing):
```bash
docker compose up -d db        # from the repo root
# in backend/.env:  DATABASE_URL=postgresql+asyncpg://ara:ara_dev_password@localhost:5432/ara
alembic upgrade head
```
Seed a demo user + sample documents (`demo@example.com` / `DemoPassw0rd!`): `python -m scripts.seed_demo`

A separate worker process is optional: set `JOB_RUNNER=external` for the API and run `python -m app.jobs.worker`.

### 2. Frontend
```bash
cd frontend
npm install --legacy-peer-deps   # the flag is needed because of a peer-range conflict in the shadcn CLI toolchain
npm run dev                    # http://localhost:3000  (proxies /api/* to BACKEND_URL, default http://localhost:8000)
# NOTE: Next bakes the rewrite target in at BUILD time — set BACKEND_URL before `npm run build` / on Vercel / as a Docker build arg.
```

### Ollama (local LLM)
macOS/Linux/Windows installers at ollama.com. `ollama serve`, `ollama pull <model>`, set `LLM_PROVIDER=ollama` and `LLM_MODEL`. Use **Settings → Test connection** in the app.

### Groq (hosted LLM)
Create an API key in the Groq console and pick a current model id from its model list. Keep the key in `backend/.env` only; it never reaches the browser.

## Testing
```bash
# backend (from backend/)
ruff check app tests migrations && mypy app && pytest                       # SQLite, no network, mock LLM + hash embeddings
TEST_DATABASE_URL=postgresql+asyncpg://ara:ara_dev_password@localhost:5432/ara_test pytest   # real PostgreSQL + pgvector + migrations
pytest -m live tests/live        # optional: real MiniLM / Ollama (LIVE_OLLAMA_MODEL=…) / Groq (GROQ_API_KEY, LIVE_GROQ_MODEL)
pip-audit -r requirements.txt

# frontend (from frontend/)
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e                 # Playwright: starts backend (mock provider) + frontend on ports 8100/3100
```
(For the PostgreSQL run create the DB once: `docker exec ara-db psql -U ara -d postgres -c "CREATE DATABASE ara_test"`.)

### CI
GitHub Actions (`.github/workflows/ci.yml`) runs backend lint/mypy/pytest (SQLite and PostgreSQL+pgvector), `pip-audit`, frontend lint/typecheck/unit/build, `npm audit`, and the Playwright e2e suite. Its first runs are reported in the repository's Actions tab.

## Configuration
All settings are documented in [`.env.example`](.env.example). The important ones: `SECRET_KEY`, `DATABASE_URL`, `CORS_ORIGINS`, `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIM`, `LLM_PROVIDER`/`LLM_MODEL`/`GROQ_API_KEY`/`OLLAMA_BASE_URL`, `STORAGE_BACKEND` (+`S3_*`), `JOB_RUNNER`, chunking and retrieval parameters. Users can override provider, model and retrieval parameters in **Settings**.

## API
Interactive docs at `/docs` (OpenAPI at `/openapi.json`). Main groups under `/api/v1`: `auth`, `documents` (+`/jobs`), `collections`, `chat` (+`/chat/stream` SSE), `conversations`, `search`, `research/{summarize,questions,findings,compare}`, `notes`, `dashboard`, `settings`, and `/health` + `/ready` at the root. Errors share one envelope: `{"error": {"code", "message", "details?"}}`.

## Status — what was actually verified (2026-10-10)
| Check | Result |
|---|---|
| Backend tests (`pytest`) | **170 passed** on SQLite; the suite also ran on real PostgreSQL 16 + pgvector (incl. Alembic migrations, `alembic check`, hybrid search, `SKIP LOCKED` claiming) |
| Backend quality | `ruff` + `mypy` clean; `pip-audit`: no known vulnerabilities. CI (GitHub Actions) backend job: passing on SQLite + PostgreSQL |
| Frontend | `eslint`, `tsc`, `next build` clean; **88 Vitest** pass; production-dependency `npm audit`: 0 vulnerabilities (dev-tooling advisories are reported non-blocking) |
| End-to-end (Playwright, offline mock LLM) | **24 passed**, 1 skipped (opt-in screenshot capture) |
| Retrieval evaluation | 33-query set over 9 documents, see [`docs/RETRIEVAL_EVAL.md`](docs/RETRIEVAL_EVAL.md): real MiniLM separates answerable from off-topic queries (100 % / 0 % at threshold 0.25); the lexical fallback cannot. Small, easy corpus: treat as indicative |
| Provider errors | missing key/model, 400/401/404/429/5xx, timeouts, malformed and mid-stream-error responses, secret redaction: unit-tested (mocked transport) |
| **Live production** (Vercel + Render + Neon) | verified in a real browser: register, upload, indexing, **Groq-answered streamed question with citation chip → evidence panel → reload restores the conversation**; second user gets 404 on the first user's conversation; conflict detection across two documents returns cited positions from both |
| Free-tier fit | local container run with Render-free limits (512 MB / 0.1 CPU): peak 265 MiB, no OOM kill (this is **not** a measurement of Render itself) |
| S3 storage | adapter exercised against the `moto` S3 *emulator* only; **never tested against a real bucket** |

## Known limitations
- **No OCR**: scanned/image-only PDFs fail with an explanatory message.
- **Off-topic gating is imperfect**: in the live test a general-knowledge question retrieved some low-relevance chunks (the model still answered "Insufficient evidence"); with the lexical `hash` fallback the threshold cannot separate off-topic queries at all.
- **Model availability changes**: Groq retires models. Use Settings → Test connection / Refresh models. The docs page listed `llama-3.3-70b-versatile`, but the live `/models` list for the key did not, which is why the app validates against the live list.
- **Render free tier**: sleeps after 15 min idle (≈1 min cold start), CPU is 0.1 so indexing large PDFs is slow, no separate worker (the worker is embedded in the API; jobs are durable in Postgres).
- **Storage**: uploads live in Neon (`STORAGE_BACKEND=db`, capped by `DB_STORAGE_QUOTA_MB`); use S3-compatible storage for larger libraries.
- **Vector store**: pgvector only (SQLite uses NumPy for local dev). Qdrant is not implemented.
- **Auth**: no email verification, password reset or MFA; rate limiting is per process.
- **PDF export** is not implemented (Markdown export only); headless browsers cannot render the PDF viewer, so e2e tests assert the `#page=N` anchor and inline serving instead.
- Not covered by browser tests: Stop button (unit-tested), prev/next between citations (unit-tested), Compare/Findings/Conflicts tabs beyond rendering, tablet/mobile layouts beyond reviewed screenshots; no automated accessibility (axe) scan.
- Small local models (e.g. 3B) sometimes omit citations; the app flags answers with no valid citation instead of inventing one.
