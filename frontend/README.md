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
| `SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts` | capture UI screenshots at 1440 / 768 / 390 px, light + dark, into `screenshots/` (git-ignored) |

## End-to-end tests

`npm run test:e2e` starts **both** servers itself — the FastAPI backend on `:8100` (fresh SQLite DB migrated with
Alembic, hash embeddings, mock LLM — no network, no paid APIs) and the production Next build on `:3100` — then drives
Chromium through registration, upload, streamed RAG answers with citations, evidence panel, viewer, isolation,
collections, settings, dashboard, notes and more.

Prerequisites: `cd ../backend && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`, then
`npx playwright install chromium`.

## Workspace UI (what lives where)

- **Shell** (`components/shared/app-shell.tsx`): grouped, collapsible sidebar (auto-collapses below 1024 px unless you chose otherwise; a live
  "indexing" badge on *Documents* comes from the dashboard endpoint), compact toolbar with breadcrumbs, global **Upload**, **New chat**, theme toggle and the
  **⌘K / Ctrl+K command palette** (`command-palette.tsx`: pages, actions, and live server-side search of documents and conversations).
- **Chat + viewer** (`features/chat`): the conversation column, thread and composer; clicking a citation opens the **source viewer** (`evidence.tsx`) —
  *docked, resizable and collapsible* beside the answer on ≥ 1280 px, a sheet below that. *Evidence* tab = exact excerpt, highlighted passage, retrieval
  scores; *Document* tab = the PDF at the cited page (browser PDF viewer) or the neighbouring extracted chunks with the passage highlighted. Prev/next steps
  through the answer's citations. Provider failures render as actionable cards (`error-cards.tsx`: not configured → link to Settings, rate limited, timeout…).
- **Dashboard** (`features/dashboard`): KPIs, library health bar, recent documents with live progress, active jobs and failures (with the real error text
  and Retry), index-health banner, query activity chart. Everything is read from the API; empty states never show invented numbers.
- **Library** (`features/documents`): list/grid toggle, file-type tiles (no fake thumbnails), search/status/collection/sort filters, bulk actions.
- **Honesty about retrieval**: `retrieval_mode` from the API is shown as *Semantic vector search* or *Lexical (keyword-like) matching* in Search, chat
  sources, Settings and health — the lexical `hash` embedder is never presented as semantic.

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
