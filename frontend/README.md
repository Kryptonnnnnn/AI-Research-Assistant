# AI Research Assistant — frontend

Next.js (App Router) + React + TypeScript (strict) + Tailwind CSS v4 + shadcn/ui (Base UI primitives) + TanStack Query.

All API calls go to **same-origin** `/api/v1/...`; `next.config.ts` rewrites `/api/*` to `BACKEND_URL`
(default `http://localhost:8000`). This keeps the `ara_session` httpOnly cookie first-party, which is what makes a
Vercel frontend + separately hosted API work without third-party-cookie problems.

## Scripts

| Command | What it does |
| --- | --- |
| `npm install --legacy-peer-deps` | install (the shadcn CLI pulls a babel peer range that npm's strict resolver rejects) |
| `npm run dev` | dev server on :3000 (start the backend on :8000 first) |
| `npm run build && npm start` | production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit/component tests (jsdom) |
| `npm run test:e2e` | Playwright end-to-end tests (see below) |

## End-to-end tests

`npm run test:e2e` starts **both** servers itself — the FastAPI backend on `:8100` (fresh SQLite DB migrated with
Alembic, hash embeddings, mock LLM — no network, no paid APIs) and the production Next build on `:3100` — then drives
Chromium through registration, upload, streamed RAG answers with citations, evidence panel, viewer, isolation,
collections, settings, dashboard, notes and more.

Prerequisites: `cd ../backend && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`, then
`npx playwright install chromium`.

## Structure

```
src/app          routes: (auth)/login|register, (app)/dashboard|documents|collections|chat|search|research|notes|settings
src/features     auth, documents, collections, chat (stream state, markdown, evidence), research, notes, dashboard, settings, search
src/components   ui/ (shadcn), shared/ (shell, dialogs, states)
src/lib          api client, SSE parser, citation remark plugins, validation, formatting
src/types        TypeScript mirror of the backend schemas
src/proxy.ts     optimistic route guard (Next 16 name for middleware)
tests/unit       Vitest      tests/e2e   Playwright
```

## Deploying

See the repository root README / `docs/` for Vercel setup. In short: set `BACKEND_URL` to the public URL of the API
in the Vercel project settings (Production + Preview). The Dockerfile builds a standalone image
(`docker build --build-arg BACKEND_URL=http://api:8000 -t ara-web .`).
