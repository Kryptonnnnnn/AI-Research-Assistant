# Deployment guide

> Status: the configuration below was **written and checked against provider documentation, but this project has not been deployed to Vercel/Render/Neon by the author's tooling**. Work through the verification checklist at the end after you deploy.

## Facts that shape the design (verified from provider docs, Oct 2026 — re-check before relying on them)
| Provider | Relevant facts | Consequence |
|---|---|---|
| Render **free web service** | spins down after 15 min idle (~1 min cold start); **ephemeral filesystem**; 750 instance-hours/month; one instance | Don't store uploads on local disk → use S3-compatible storage. Expect a slow first request. |
| Render **background workers** | not available on the free plan | The job worker runs **inside the API process** (`JOB_RUNNER=embedded`). Jobs live in PostgreSQL, so a restart just re-queues interrupted work (stale-job recovery). |
| Render **free Postgres** | 1 GB, **expires 30 days after creation** | Use Neon (below) for a durable free DB. |
| Neon (free Postgres) | pgvector available on every plan (`CREATE EXTENSION vector`), HNSW supported | The Alembic migration enables the extension and builds HNSW + full-text indexes. |
| Vercel | proxied (rewrite) requests to an external origin time out at most after 120 s | Chat answers must start streaming well within that; fine for Groq. Very large uploads through the proxy may hit platform limits (not verified) — keep files ≲ 25 MB (default limit) and test. |
| PyTorch / sentence-transformers | large (~1 GB image, hundreds of MB RAM) | Too heavy for the 512 MB / 0.1 CPU free plan. Use fastembed (ONNX) instead; see "Embeddings on free hosting". |

## Architecture
`Browser → Vercel (Next.js, proxies /api/*) → Render (FastAPI + embedded worker) → Neon Postgres+pgvector`, files in S3-compatible storage (e.g. Cloudflare R2 / Backblaze B2 / Supabase Storage), LLM from Groq. Locally you can swap in Ollama and local disk.

The browser only ever talks to the Vercel origin; Next rewrites `/api/*` to the backend. That keeps the session cookie first-party (no third-party-cookie problems, no CORS in the browser path).

## 1. Database (Neon)
1. Create a project at neon.com, copy the connection string (`postgresql://user:pass@host/db?sslmode=require`).
2. Use it as `DATABASE_URL` exactly as Neon shows it. The app converts `postgres://`/`postgresql://` to the asyncpg driver and translates `?sslmode=require` to asyncpg's `ssl=require` (and back for Alembic) — covered by a unit test, not yet by a live Neon connection.
3. Migrations (from `backend/`): `DATABASE_URL=... alembic upgrade head` (the Docker image runs this on every start).
4. Check: `select extname from pg_extension where extname='vector';`

## 2. File storage
Simplest: `STORAGE_BACKEND=db` stores uploads in PostgreSQL (what the live deployment uses; every upload counts against the DB quota, e.g. Neon free ≈ 0.5 GB). If `STORAGE_BACKEND=s3` is set but `S3_BUCKET` is empty, the app logs a warning and falls back to `db`; `/ready` shows which backend is active and, if storage is broken, the error class. For larger libraries use S3-compatible storage:

Create a bucket and an access key in any S3-compatible service and set `STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (`S3_REGION=auto` for R2). The Docker image installs `boto3` (`WITH_S3=1`). The S3 adapter is covered by code review only — local storage is what the automated tests exercise, so do a manual upload/download/delete check.

## 3. API on Render
1. Push the repo to GitHub. In Render: **New → Blueprint**, pick the repo (it reads `render.yaml`), or create a Docker web service with root dir `backend`.
2. Fill the `sync: false` variables: `DATABASE_URL`, `CORS_ORIGINS` (your Vercel URL, no trailing slash), S3 variables, `GROQ_API_KEY`, `LLM_MODEL`.
   - `LLM_MODEL`: choose a currently available model id from the Groq console's model list; the app deliberately hard-codes none.
3. Health check path: `/health` (liveness). `/ready` reports DB/pgvector/queue state.
4. First deploy logs should show `Started (env=production, jobs=embedded, ...)`.

### Embeddings on free hosting
The image ships `fastembed` (the same all-MiniLM-L6-v2 model executed by ONNX Runtime, no PyTorch) with the model **baked in**, and the
blueprint sets `EMBEDDING_PROVIDER=fastembed`, `EMBEDDING_BATCH_SIZE=4`. Measured in the real image run with Docker limits equal to Render's
free plan (`--memory=512m --cpus=0.1`): idle 83 MiB → **peak 265 MiB**, a 40-page PDF + 9 documents indexed with no OOM kill, relevant
questions returned cited passages (incl. PDF page numbers) and an off-topic question returned "insufficient evidence". This is a local
container test, **not** a measurement of Render itself; watch the service's memory graph after deploying.
If the instance is OOM-killed or too slow, fall back to `EMBEDDING_PROVIDER=hash` (lexical; the UI and `/ready` label it so; "insufficient evidence"
is unreliable in that mode, see `docs/RETRIEVAL_EVAL.md`) or upgrade the instance.
Switching embedding model/chunking later is safe: each document stores an `index_signature`; on startup (`AUTO_REINDEX=true`) documents with a
different signature are re-queued and atomically re-indexed, and retrieval never searches vectors from a different model in the meantime.

Qdrant was not implemented; pgvector is the vector store. (Qdrant Cloud has a free tier if you ever add an adapter behind `app/vectorstore`.)

## 4. Frontend on Vercel
1. **Add New → Project**, import the repo, set **Root Directory** to `frontend`.
2. Environment variable: `BACKEND_URL=https://<your-render-service>.onrender.com`.
3. Deploy. Then set that Vercel URL as `CORS_ORIGINS` on Render (needed for direct API access / docs; the proxied path doesn't need CORS).
4. Vercel Hobby is for non-commercial use; check the current terms.

## 5. Production environment variables
See `.env.example`. Minimum: `APP_ENV=production`, `SECRET_KEY` (32+ chars; Render can generate it), `COOKIE_SECURE=true`, `CORS_ORIGINS`, `DATABASE_URL`, storage vars, LLM vars, `ALLOW_MOCK_PROVIDER=false`. The app refuses to boot in production with the default secret or `*` CORS.

## Local Ollama / Groq
- Ollama: `ollama serve`, `ollama pull <model>`, then `LLM_PROVIDER=ollama`, `LLM_MODEL=<name from ollama list>`; verify with **Settings → Test connection**.
- Groq: create a key in the Groq console, `LLM_PROVIDER=groq`, `GROQ_API_KEY=...`, `LLM_MODEL=<current id>`. Free-tier rate limits apply (the UI shows a clear message on HTTP 429).

## Verification checklist
- [ ] `GET <api>/health` → `{"status":"ok"}`; `GET <api>/ready` → `ready`, `pgvector.ok: true`
- [ ] Register on the Vercel URL; cookie is `HttpOnly; Secure`
- [ ] Upload a PDF → status goes queued → processing → ready (first request may wait ~1 min for the cold start)
- [ ] File exists in the bucket; deleting the document removes it
- [ ] Ask a question → streamed answer with citation chips; click one → evidence panel/page
- [ ] Refresh → conversation persists
- [ ] Second account cannot open the first account's document URL (404)
- [ ] Settings → Test connection OK for your provider
- [ ] Restart the Render service mid-processing → the document still finishes (job recovery)
