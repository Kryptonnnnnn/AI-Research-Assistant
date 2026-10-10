"""Retrieval evaluation harness.

    python -m eval.run_eval                 # full matrix (needs fastembed; sentence-transformers optional)
    python -m eval.run_eval --quick         # hash-only, no model downloads (also what the unit test runs)

Runs the REAL ingestion + retrieval code (chunking, embeddings, SQLite/NumPy store, hybrid scoring, dedupe, thresholds) over
eval/corpus with eval/queries.json. A positive query is a hit at rank r if the r-th retrieved chunk contains the expected span.
Writes docs/RETRIEVAL_EVAL.md (full run) or prints a table (quick).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TMP = tempfile.mkdtemp(prefix="ara-eval-")
os.environ.update(
    DATABASE_URL=f"sqlite+aiosqlite:///{TMP}/e.db",
    STORAGE_LOCAL_DIR=f"{TMP}/up",
    JOB_RUNNER="disabled",
    RATE_LIMIT_ENABLED="false",
)

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings, reset_settings_cache  # noqa: E402
from app.db.base import Base, dispose_engine, get_engine, get_sessionmaker  # noqa: E402
from app.embeddings.factory import set_embedding_provider  # noqa: E402
from app.embeddings.hash_provider import HashEmbeddingProvider  # noqa: E402
from app.jobs import queue  # noqa: E402
from app.models import Document, User  # noqa: E402
from app.rag.retriever import RetrievalParams, retrieve  # noqa: E402
from app.services import document_service  # noqa: E402
from app.storage.factory import set_storage  # noqa: E402

KS = (1, 3, 5, 8)
SWEEP = (0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5)


def load():
    queries = json.loads((ROOT / "queries.json").read_text())
    # Ingested as plain text with headings removed -> one long segment per document (like a PDF page), so the chunk size matters.
    docs = {}
    for p in sorted((ROOT / "corpus").glob("*.md")):
        body = "\n".join(ln for ln in p.read_text().splitlines() if not ln.startswith("#"))
        docs[p.stem + ".txt"] = body.encode()
    return queries, docs


async def run_config(name, provider, chunk, overlap, hybrid, threshold, queries, docs, db_idx):
    os.environ.update(
        DATABASE_URL=f"sqlite+aiosqlite:///{TMP}/e{db_idx}.db",
        STORAGE_LOCAL_DIR=f"{TMP}/up{db_idx}",
        CHUNK_SIZE_TOKENS=str(chunk),
        CHUNK_OVERLAP_TOKENS=str(overlap),
        EMBEDDING_BATCH_SIZE="8",
    )
    reset_settings_cache()
    await dispose_engine()
    set_storage(None)
    set_embedding_provider(provider)
    async with get_engine().begin() as c:
        await c.run_sync(Base.metadata.create_all)
    sm = get_sessionmaker()
    t0 = time.perf_counter()
    async with sm() as db:
        user = User(email="eval@example.com", password_hash="x")
        db.add(user)
        await db.commit()
        for fname, data in docs.items():
            await document_service.ingest_upload(db, user.id, fname, "text/plain", data)
    await queue.drain(sm)
    index_s = time.perf_counter() - t0
    async with sm() as db:
        ids = list((await db.execute(select(Document.id))).scalars())
        chunks = sum((await db.execute(select(Document.chunk_count))).scalars())
        ranks, lat = [], []
        n_pos = n_neg = 0
        sweep: dict[float, dict[str, int]] = {}
        misses: list[dict] = []
        by_kind: dict[str, list[int | None]] = {}
        for q in queries:
            t = time.perf_counter()
            # ranking quality is measured without a threshold (it only gates "answerable?"), production top_k
            ranked = (
                await retrieve(db, user.id, q["query"], ids, RetrievalParams(8, -1.0, hybrid, 10**9), fit_budget=False)
            ).chunks
            lat.append((time.perf_counter() - t) * 1000)
            for thr in SWEEP:
                gated = (
                    await retrieve(db, user.id, q["query"], ids, RetrievalParams(8, thr, hybrid, 10**9), fit_budget=False)
                ).chunks
                tally = sweep.setdefault(thr, {"ans": 0, "fp": 0})
                if q["kind"] == "negative":
                    tally["fp"] += bool(gated)
                else:
                    tally["ans"] += bool(gated)
            if q["kind"] == "negative":
                n_neg += 1
                continue
            n_pos += 1
            rank = next((i + 1 for i, c in enumerate(ranked) if q["span"] in c.text), None)
            ranks.append(rank)
            if rank is None or rank > 1:
                misses.append({"query": q["query"], "kind": q["kind"], "rank": rank})
            by_kind.setdefault(q["kind"], []).append(rank)
    await dispose_engine()

    def hit(rs, k):
        return sum(1 for r in rs if r is not None and r <= k) / len(rs)

    def mrr(rs):
        return sum(1 / r for r in rs if r) / len(rs)

    res = {
        "name": name,
        "chunk": chunk,
        "overlap": overlap,
        "hybrid": hybrid,
        "threshold": threshold,
        "chunks": chunks,
        "misses": misses,
        "index_s": round(index_s, 2),
        **{f"hit@{k}": round(hit(ranks, k), 3) for k in KS},
        "mrr": round(mrr(ranks), 3),
        "p_hit@3": round(hit(by_kind["paraphrase"], 3), 3),
        "k_hit@3": round(hit(by_kind["keyword"], 3), 3),
        "sweep": {
            str(t): {"answerable": round(v["ans"] / n_pos, 3), "false_pos": round(v["fp"] / n_neg, 3)} for t, v in sweep.items()
        },
        "lat_ms_p50": round(statistics.median(lat), 1),
        "lat_ms_max": round(max(lat), 1),
    }
    return res


def table(rows):
    cols = [
        "name",
        "chunk/ovl",
        "hybrid",
        "chunks",
        "hit@1",
        "hit@3",
        "hit@5",
        "MRR",
        "paraphrase hit@3",
        "keyword hit@3",
        "index s",
        "p50 ms",
    ]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        out.append(
            f"| {r['name']} | {r['chunk']}/{r['overlap']} | {'on' if r['hybrid'] else 'off'} | {r['chunks']} | {r['hit@1']:.2f} | {r['hit@3']:.2f} | "
            f"{r['hit@5']:.2f} | {r['mrr']:.2f} | {r['p_hit@3']:.2f} | {r['k_hit@3']:.2f} | {r['index_s']} | {r['lat_ms_p50']} |"
        )
    out += [
        "",
        "Threshold sweep (answerable = share of the 27 answerable queries that return >=1 chunk; false-pos = share of the 6 off-topic queries that return >=1 chunk):",
        "",
    ]
    out += ["| config | " + " | ".join(f"{t}" for t in SWEEP) + " |", "|---|" + "---|" * len(SWEEP)]
    for r in rows:
        label = f"{r['name']} {r['chunk']}/{r['overlap']} {'hybrid' if r['hybrid'] else 'vector-only'}"
        out.append(
            f"| {label} | "
            + " | ".join(f"{r['sweep'][str(t)]['answerable']:.2f} / {r['sweep'][str(t)]['false_pos']:.2f}" for t in SWEEP)
            + " |"
        )
    return "\n".join(out)


async def main(quick: bool, write: bool):
    queries, docs = load()
    s = get_settings()
    hashp = HashEmbeddingProvider(s.embedding_dim, "hash-bow-v1")
    plan = [("hash", hashp, 800, 120, True, 0.1), ("hash", hashp, 800, 120, False, 0.1), ("hash", hashp, 200, 40, True, 0.1)]
    if not quick:
        from app.embeddings.fastembed_provider import FastEmbedProvider

        fe = FastEmbedProvider("sentence-transformers/all-MiniLM-L6-v2", 384, 8)
        fe.warmup()
        plan += [
            ("fastembed MiniLM", fe, 800, 120, True, 0.25),
            ("fastembed MiniLM", fe, 800, 120, False, 0.25),
            ("fastembed MiniLM", fe, 400, 60, True, 0.25),
            ("fastembed MiniLM", fe, 200, 40, True, 0.25),
            ("fastembed MiniLM", fe, 200, 40, False, 0.25),
            ("fastembed MiniLM", fe, 120, 24, True, 0.25),
        ]
        try:
            from app.embeddings.sentence_provider import SentenceTransformerProvider

            st = SentenceTransformerProvider("sentence-transformers/all-MiniLM-L6-v2", 384, 8)
            st.warmup()
            plan.append(("sentence-transformers MiniLM", st, 200, 40, True, 0.25))
        except Exception as exc:  # noqa: BLE001
            print("sentence-transformers skipped:", type(exc).__name__)
    rows = []
    for i, (name, prov, chunk, ovl, hybrid, thr) in enumerate(plan):
        r = await run_config(name, prov, chunk, ovl, hybrid, thr, queries, docs, i)
        rows.append(r)
        print(
            f"{name:30s} chunk={chunk:4d} hybrid={hybrid!s:5s} hit@1={r['hit@1']:.2f} hit@3={r['hit@3']:.2f} mrr={r['mrr']:.2f} "
            f"p50={r['lat_ms_p50']}ms",
            flush=True,
        )
    md = table(rows)
    print("\n" + md)
    if write:
        (ROOT.parent.parent / "docs" / "RETRIEVAL_EVAL.json").write_text(json.dumps(rows, indent=1))
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    asyncio.run(main(a.quick, a.write))
    sys.exit(0)
