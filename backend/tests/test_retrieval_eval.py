"""Deterministic retrieval-quality regression test on the evaluation corpus (hash embedder: no downloads).

Thresholds are set a little below measured values (see docs/RETRIEVAL_EVAL.md) so real regressions fail but noise doesn't.
"""

import pytest

from eval import run_eval as E

pytestmark = pytest.mark.filterwarnings("ignore")


def test_corpus_and_queries_are_consistent():
    queries, docs = E.load()
    assert len(docs) == 9 and sum(q["kind"] == "negative" for q in queries) == 6
    text = {n: d.decode() for n, d in docs.items()}
    for q in queries:
        if q["span"]:
            assert q["span"] in text[q["doc"].replace(".md", ".txt")], q


async def test_hybrid_retrieval_quality_floor_and_hybrid_beats_vector_only():
    queries, docs = E.load()
    prov = E.HashEmbeddingProvider(384, "hash-bow-v1")
    hybrid = await E.run_config("hash", prov, 800, 120, True, 0.1, queries, docs, 70)
    vector_only = await E.run_config("hash", prov, 800, 120, False, 0.1, queries, docs, 71)
    assert hybrid["hit@3"] >= 0.9 and hybrid["mrr"] >= 0.85
    assert hybrid["hit@1"] >= vector_only["hit@1"] + 0.2  # the keyword half of hybrid retrieval measurably helps
    assert {m["query"] for m in hybrid["misses"]} <= {q["query"] for q in queries}
    # known limitation, asserted so nobody "fixes" docs without re-measuring: the lexical embedder cannot gate off-topic queries
    assert hybrid["sweep"]["0.1"]["false_pos"] == 1.0
