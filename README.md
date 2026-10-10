# AI Research Assistant (RAG)

A full-stack research workspace: upload PDFs, DOCX, TXT and Markdown, organise them into collections, and ask questions that are answered **only from your documents, with verifiable citations**. Built with Next.js, FastAPI, PostgreSQL + pgvector, local Sentence-Transformers embeddings, and pluggable LLMs (Groq, Ollama, or an offline mock).

## Live demo
- App: https://ai-research-assistant-beta-flame.vercel.app (Vercel → proxies `/api/*` to the API)
- API docs: https://ai-research-assistant-api-gwcu.onrender.com/docs · readiness: `/ready`
- Free tiers: the API sleeps after 15 min idle (first request ≈ 1 min). Embeddings are the lexical `hash` embedder there, and chat needs `LLM_MODEL` (+ `GROQ_API_KEY`) set on the API service.

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

### Enabling CI
The GitHub Actions workflow lives at `docs/ci-workflow.yml` (pushing workflow files needs a token with the `workflow` scope). To enable it: `gh auth refresh -s workflow`, then `mkdir -p .github/workflows && git mv docs/ci-workflow.yml .github/workflows/ci.yml && git commit -m "Enable CI" && git push`. It has not been run on GitHub yet.

## Configuration
All settings are documented in [`.env.example`](.env.example). The important ones: `SECRET_KEY`, `DATABASE_URL`, `CORS_ORIGINS`, `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIM`, `LLM_PROVIDER`/`LLM_MODEL`/`GROQ_API_KEY`/`OLLAMA_BASE_URL`, `STORAGE_BACKEND` (+`S3_*`), `JOB_RUNNER`, chunking and retrieval parameters. Users can override provider, model and retrieval parameters in **Settings**.

## API
Interactive docs at `/docs` (OpenAPI at `/openapi.json`). Main groups under `/api/v1`: `auth`, `documents` (+`/jobs`), `collections`, `chat` (+`/chat/stream` SSE), `conversations`, `search`, `research/{summarize,questions,findings,compare}`, `notes`, `dashboard`, `settings`, and `/health` + `/ready` at the root. Errors share one envelope: `{"error": {"code", "message", "details?"}}`.

## Status — what was actually verified
| Check | Result |
|---|---|
| Backend tests (`pytest`) | **123 passed** on SQLite and on real PostgreSQL 16 + pgvector (including Alembic migrations, `alembic check`, hybrid search, `SKIP LOCKED` job claiming) |
| Backend quality | `ruff` clean, `mypy` clean (80 files), `pip-audit`: no known vulnerabilities |
| Frontend | `eslint`, `tsc --noEmit`, `next build` clean; **46 Vitest** tests pass |
| End-to-end (Playwright, offline, mock LLM) | **13 passed**: auth, upload→processing→streamed answer→citation→evidence panel→viewer page→reload persistence, cross-user isolation, insufficient-evidence, collections, settings/theme, dashboard, notes, regenerate/follow-ups, mobile nav |
| Real stack smoke test (manual) | Postgres + pgvector + real `all-MiniLM-L6-v2` + real PDF + local Ollama `llama3.2`: correct page-level citations, off-topic question refused, tokens stream incrementally through the Next proxy |
| Optional live tests (`-m live`) | MiniLM semantic ranking ✅, Ollama ✅, **Groq not run** (no API key available while building; its request/stream/error handling is tested against a mocked HTTP transport only) |
| Deployment | **Not deployed.** Config for Render/Vercel/Neon is written from the providers' current docs but unverified in production — follow the checklist in `docs/DEPLOYMENT.md` |

## Known limitations
- **No OCR**: scanned/image-only PDFs fail with an explanatory message.
- **Embeddings on free hosting**: PyTorch is too heavy to assume on free tiers, so the Render blueprint defaults to the lexical `hash` embedder (works, but not semantic). Real semantic search needs `sentence-transformers` (local / paid instance) — see deployment doc.
- **Vector store**: pgvector only (SQLite uses NumPy brute force for local dev). Qdrant is not implemented.
- **Rate limiting** is in-memory per process; no email verification, password reset or MFA.
- **Render free tier** spins down after 15 min idle (slow first request) and has no background workers, so the job worker is embedded in the API process; uploads must use S3-compatible storage there (the S3 adapter is untested against a live bucket).
- **Token counting** is an approximation (regex tokenizer), so chunk/context budgets are approximate.
- **PDF export** is not implemented (Markdown export only). PDF viewing uses the browser's native viewer; headless browsers can't render it, so e2e tests assert the page anchor and inline serving instead.
- Small local models (e.g. 3B) sometimes omit citations or reason imperfectly; the app flags answers with no valid citations instead of inventing any.
- Not covered by browser tests: the Stop button (unit-tested + backend-tested), Compare/Findings tabs, tablet/mobile layouts of every page (screenshots reviewed for the main ones).
