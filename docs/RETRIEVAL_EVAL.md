# Retrieval evaluation

Measured with `backend/eval/run_eval.py` over the real ingestion + retrieval code (chunking, embeddings, store, hybrid scoring,
dedupe, thresholds). Reproduce: `cd backend && python -m eval.run_eval --write` (needs `fastembed`; `--quick` is hash-only, no downloads).
A deterministic subset runs in CI as `tests/test_retrieval_eval.py`.

## What was measured — and what this can and cannot show
- **Corpus:** 9 short original documents (biology, ML, medicine, geology, networking, economics, ecology, plus two deliberately
  *conflicting* remote-work studies), ingested as plain text so each document is one long segment (like a PDF page).
- **Queries:** 27 answerable (21 paraphrased questions with little word overlap + 6 exact keyword lookups) and 6 off-topic.
  A query is a **hit at rank r** when the r-th returned chunk contains the expected exact passage.
- **Caveats (please read):** tiny and easy corpus (9 docs) · one query ≈ 0.04 · English only · synthetic text written by the
  project author · latency measured on a developer laptop, **not** on Render's 0.1 CPU · no significance testing.
  Treat differences of one or two queries as noise. Absolute numbers will be lower on large, messy real libraries.

## Ranking quality (top_k = 8, no relevance threshold)
| name | chunk/ovl | hybrid | chunks | hit@1 | hit@3 | hit@5 | MRR | paraphrase hit@3 | keyword hit@3 | index s | p50 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hash | 800/120 | on | 9 | 0.89 | 1.00 | 1.00 | 0.93 | 1.00 | 1.00 | 0.1 | 1.7 |
| hash | 800/120 | off | 9 | 0.56 | 0.85 | 0.93 | 0.72 | 0.86 | 0.83 | 0.08 | 1.5 |
| hash | 200/40 | on | 18 | 0.89 | 0.96 | 0.96 | 0.91 | 1.00 | 0.83 | 0.08 | 1.9 |
| fastembed MiniLM | 800/120 | on | 9 | 0.96 | 1.00 | 1.00 | 0.97 | 1.00 | 1.00 | 0.24 | 3.4 |
| fastembed MiniLM | 800/120 | off | 9 | 0.93 | 1.00 | 1.00 | 0.96 | 1.00 | 1.00 | 0.22 | 3.2 |
| fastembed MiniLM | 400/60 | on | 9 | 0.96 | 1.00 | 1.00 | 0.97 | 1.00 | 1.00 | 0.26 | 3.5 |
| fastembed MiniLM | 200/40 | on | 18 | 0.96 | 0.96 | 0.96 | 0.96 | 0.95 | 1.00 | 0.27 | 3.5 |
| fastembed MiniLM | 200/40 | off | 18 | 0.89 | 0.89 | 0.89 | 0.89 | 0.86 | 1.00 | 0.27 | 3.4 |
| fastembed MiniLM | 120/24 | on | 28 | 0.93 | 0.93 | 0.93 | 0.93 | 0.91 | 1.00 | 0.26 | 3.7 |
| sentence-transformers MiniLM | 200/40 | on | 18 | 0.96 | 0.96 | 0.96 | 0.96 | 0.95 | 1.00 | 1.4 | 8.4 |

## Threshold sweep: "can the system tell it has no evidence?"
Each cell is `answerable / false-positive`: the share of the 27 answerable queries that return at least one chunk, and the share of
the 6 off-topic queries that (wrongly) do. The app answers "insufficient evidence" only when nothing clears the threshold.

| config | 0.1 | 0.15 | 0.2 | 0.25 | 0.3 | 0.35 | 0.4 | 0.5 |
|---|---|---|---|---|---|---|---|---|
| hash 800/120 hybrid | 1.00 / 1.00 | 0.96 / 0.83 | 0.93 / 0.50 | 0.85 / 0.33 | 0.78 / 0.17 | 0.67 / 0.00 | 0.52 / 0.00 | 0.11 / 0.00 |
| hash 800/120 vector-only | 1.00 / 1.00 | 0.89 / 0.83 | 0.85 / 0.33 | 0.48 / 0.00 | 0.11 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| hash 200/40 hybrid | 1.00 / 1.00 | 0.96 / 1.00 | 0.96 / 0.50 | 0.96 / 0.33 | 0.89 / 0.17 | 0.70 / 0.17 | 0.59 / 0.00 | 0.15 / 0.00 |
| fastembed MiniLM 800/120 hybrid | 1.00 / 0.83 | 0.96 / 0.33 | 0.96 / 0.00 | 0.93 / 0.00 | 0.93 / 0.00 | 0.85 / 0.00 | 0.78 / 0.00 | 0.63 / 0.00 |
| fastembed MiniLM 800/120 vector-only | 1.00 / 0.83 | 0.96 / 0.17 | 0.93 / 0.00 | 0.78 / 0.00 | 0.63 / 0.00 | 0.63 / 0.00 | 0.56 / 0.00 | 0.30 / 0.00 |
| fastembed MiniLM 400/60 hybrid | 1.00 / 0.83 | 0.96 / 0.33 | 0.96 / 0.00 | 0.93 / 0.00 | 0.93 / 0.00 | 0.85 / 0.00 | 0.78 / 0.00 | 0.63 / 0.00 |
| fastembed MiniLM 200/40 hybrid | 1.00 / 1.00 | 1.00 / 0.33 | 1.00 / 0.00 | 1.00 / 0.00 | 0.96 / 0.00 | 0.93 / 0.00 | 0.93 / 0.00 | 0.78 / 0.00 |
| fastembed MiniLM 200/40 vector-only | 1.00 / 1.00 | 1.00 / 0.33 | 0.96 / 0.00 | 0.96 / 0.00 | 0.81 / 0.00 | 0.70 / 0.00 | 0.59 / 0.00 | 0.37 / 0.00 |
| fastembed MiniLM 120/24 hybrid | 1.00 / 0.83 | 1.00 / 0.67 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.96 / 0.00 | 0.93 / 0.00 | 0.85 / 0.00 |
| sentence-transformers MiniLM 200/40 hybrid | 1.00 / 1.00 | 1.00 / 0.33 | 1.00 / 0.00 | 1.00 / 0.00 | 0.96 / 0.00 | 0.93 / 0.00 | 0.93 / 0.00 | 0.78 / 0.00 |

## Findings
1. **Real embeddings matter most for the threshold, not for ranking.** On this corpus the hash (lexical) embedder with hybrid scoring
   ranks nearly as well as MiniLM (hit@3 1.00 vs 1.00; hit@1 0.89 vs 0.96) because the queries and documents are small and share
   vocabulary. But the hash embedder **cannot separate off-topic from answerable queries**: at the threshold used in the first
   deployment (0.1) it returned results for **100 %** of off-topic questions, and any threshold that removes them also drops a third or
   more of the answerable ones. MiniLM reaches **100 % answerable with 0 % false positives at 0.20–0.25** (0.96 at 0.30).
   Consequence: with the lexical fallback the "insufficient evidence" safeguard is largely ineffective, which is why the UI and
   `/ready` label it **lexical**, not semantic.
2. **Hybrid (vector + keyword) helps.** hash: hit@1 0.56 → 0.89. MiniLM at 200/40: 0.89 → 0.96, and much better thresholding
   (answerable at 0.35: 0.70 → 0.93). The keyword side also guarantees exact-term queries (`RuBisCO`, `Reno CUBIC`) are found.
3. **Chunk size.** 200–400 tokens beat 800 on the cosine scores that thresholding depends on (MiniLM, threshold 0.25, hybrid:
   answerable 1.00 at 200/40 vs 0.93 at 800/120 and 400/60); 120/24 was slightly worse at ranking (hit@1 0.93). MiniLM-class models
   read only ~256 tokens, so long chunks are diluted. **Default changed from 800/120 to 200/40.** Changing it makes existing documents
   stale; they are re-indexed automatically (see `index_signature`).
4. **fastembed (ONNX) ≡ sentence-transformers (PyTorch) for the same model:** identical metrics at 200/40 and identical cosine values on
   spot checks; fastembed queries took ~3.5 ms vs ~8.4 ms here.
5. **Failure cases seen:** MiniLM 200/40 missed one query (*"What does the sender do when it gets a timeout instead of repeated acks?"*)
   because the answer sentence was not in any of the top-8 chunks (chunk boundary), a reminder that overlap and top-k matter. The hash
   embedder confused the two near-identical remote-work studies and ranked the right passage 2nd/3rd for three queries.
6. **Latency** (local): retrieval p50 ≈ 1.7 ms (hash) / 3.5 ms (fastembed) / 8.4 ms (torch) over 9–28 chunks incl. query embedding;
   indexing 9 documents ≈ 0.1 s (hash) / 0.25 s (fastembed). Expect much slower on a 0.1-CPU free instance.

## Decisions taken from this evidence
| Setting | Value | Why |
|---|---|---|
| `CHUNK_SIZE_TOKENS / OVERLAP` | 200 / 40 | best answerable-at-zero-false-positive result; matches 256-token embedders |
| `RETRIEVAL_SCORE_THRESHOLD` (MiniLM) | 0.25 | inside the 0.20–0.30 plateau with 0 % false positives |
| hybrid retrieval | on | better in every comparison |
| lexical `hash` provider | kept, labelled | offline/test fallback only; never described as semantic |

## Memory fit for a 512 MB host (measured on macOS, Python 3.11)
API process alone ≈ 153 MB RSS; plus the fastembed MiniLM model ≈ 290 MB steady state in a clean process; a batch of 32 long texts
peaked at ≈ 560–600 MB. On a 512 MB instance use `EMBEDDING_BATCH_SIZE=4–8` and treat the fit as **tight and unproven until observed on
the real service** (see the deployment status in the README). PyTorch/sentence-transformers needs substantially more and is not
suitable for a 512 MB instance.
