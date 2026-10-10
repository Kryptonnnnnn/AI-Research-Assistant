"""Optional live integration tests (real model downloads / local Ollama / hosted Groq).

Run with:  pytest -m live tests/live -v
  - sentence-transformers: needs requirements-ml.txt and (first run) internet to fetch the model
  - Ollama: needs a running server; set LIVE_OLLAMA_MODEL to an installed model (see `ollama list`)
  - Groq: needs GROQ_API_KEY and LIVE_GROQ_MODEL (pick a current id from the Groq console)
"""

import os

import httpx
import pytest

from app.llm.base import ChatMessage
from tests.conftest import PHOTO, TRANSFORMER

pytestmark = pytest.mark.live
MSGS = [ChatMessage("user", "Reply with the single word: ok")]


def test_sentence_transformers_semantic_ranking():
    pytest.importorskip("sentence_transformers")
    from app.embeddings.sentence_provider import SentenceTransformerProvider

    p = SentenceTransformerProvider("sentence-transformers/all-MiniLM-L6-v2", 384)
    docs = p.embed_documents([PHOTO, TRANSFORMER])
    sims = docs @ p.embed_query("How do plants make sugar from sunlight?")  # no shared keywords with the text
    assert sims[0] > 0.4 > 0.25 > sims[1]
    off_topic = docs @ p.embed_query("Who won the 1966 football world cup final?")
    assert off_topic.max() < 0.25  # the default RETRIEVAL_SCORE_THRESHOLD rejects it


async def test_ollama_live():
    model = os.environ.get("LIVE_OLLAMA_MODEL")
    base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    if not model:
        pytest.skip("set LIVE_OLLAMA_MODEL")
    try:
        async with httpx.AsyncClient(timeout=2) as c:
            await c.get(f"{base}/api/tags")
    except httpx.HTTPError:
        pytest.skip("Ollama not reachable")
    from app.llm.ollama_provider import OllamaProvider

    p = OllamaProvider(base, model, 120)
    assert await p.check()
    assert (await p.complete(MSGS, temperature=0, max_tokens=10)).strip()
    assert "".join([t async for t in p.stream(MSGS, temperature=0, max_tokens=10)]).strip()


async def test_groq_live():
    key, model = os.environ.get("GROQ_API_KEY"), os.environ.get("LIVE_GROQ_MODEL")
    if not (key and model):
        pytest.skip("set GROQ_API_KEY and LIVE_GROQ_MODEL")
    from app.llm.groq_provider import GroqProvider

    p = GroqProvider(key, model, "https://api.groq.com/openai/v1", 60)
    assert (await p.complete(MSGS, temperature=0, max_tokens=10)).strip()
    assert "".join([t async for t in p.stream(MSGS, temperature=0, max_tokens=10)]).strip()
