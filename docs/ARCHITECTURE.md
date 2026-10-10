# Architecture

```
frontend (Next.js App Router, Tailwind, shadcn/ui)
   │  same-origin /api/* (rewrite)  ── SSE for chat streaming
backend (FastAPI)
   ├─ api/routers      thin HTTP layer (auth, documents, collections, chat, research, notes, meta)
   ├─ services/        business logic (auth, documents, collections, conversations, notes, dashboard, settings)
   ├─ repositories/    ownership-enforcing lookups (404 for foreign resources)
   ├─ ingestion/       validation → extractors (pypdf/python-docx/text) → cleaning → token-aware chunking → pipeline
   ├─ embeddings/      provider interface: sentence-transformers | ollama | hash
   ├─ vectorstore/     pgvector (cosine + FTS) | NumPy fallback for SQLite
   ├─ rag/             scope → retriever (hybrid, threshold, dedupe, budget) → prompts → pipeline (events) → citations
   ├─ llm/             provider interface: groq | ollama | mock (all with streaming)
   ├─ storage/         local | S3-compatible
   └─ jobs/            DB-backed queue (SKIP LOCKED claim, retries, stale recovery) + embedded/external worker
PostgreSQL (+pgvector)   users, sessions, documents, chunks(+vector), collections, conversations, messages, citations, notes, jobs, settings, query_logs
```

## Key flows
**Ingestion.** Upload → validate (ext/MIME/magic/size) → SHA-256 dedupe → store under a random key → `documents` row + `processing_jobs` row → worker claims the job → extract → chunk (default 800 tokens, 120 overlap, never crossing page/heading boundaries) → embed in batches (progress updates) → atomically swap chunks → `ready`. Permanent errors (scanned PDF, corrupt, empty) fail immediately with a readable message; transient errors retry with exponential backoff up to `JOB_MAX_ATTEMPTS`; a crashed worker's job is recovered after `JOB_STALE_SECONDS`.

**Question answering.** Resolve scope (owned + ready docs only) → embed query → vector top-N and keyword top-N (pgvector `<=>` / `ts_rank_cd`) → relevance threshold (keyword hits can rescue near-misses) → near-duplicate removal → per-document balancing for multi-doc scope → context token budget → label sources `S1…` → prompt → stream tokens → **validate citations** (strip ids that were not retrieved) → persist message + citation snapshots (title/page/excerpt/chunk text, so they survive document deletion). If nothing clears the threshold the model is **not called** and the user is told evidence is insufficient.

**Sessions.** JWT with `sid`; the `user_sessions` row is the source of truth (revocation, expiry).

## Data model
UUID primary keys; `ON DELETE CASCADE` from users to everything they own; message citations use `SET NULL` for chunk/document so history remains readable; `UNIQUE(user_id, content_hash)` on documents; `UNIQUE(user_id, name)` on collections; composite PK on `collection_documents`; denormalised `user_id` on chunks so vector queries filter by owner without a join. Postgres-only indexes (HNSW cosine, GIN full-text) are created in the migration.

## Design decisions / trade-offs
- DB-as-queue instead of Redis/Celery: zero paid infrastructure, durable across restarts, fine for a single small instance.
- SQLite fallback with NumPy search: zero-setup local dev and fast tests; Postgres is the target and is also tested (see README).
- Tokens are approximated by a regex tokenizer (no model download). Budgets are therefore approximate.
- No OCR; scanned PDFs get a clear error.
- No PDF export (Markdown export only).
