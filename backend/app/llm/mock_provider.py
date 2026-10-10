"""Deterministic offline provider for tests and demos. It never calls a network.

It "answers" by quoting the first sentence of the sources found in the prompt, citing them
with [S#] markers, so the full RAG + citation pipeline can be tested end-to-end.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator

from app.llm.base import ChatMessage

_SOURCE_RE = re.compile(r"<source id=\"(S\d+)\"[^>]*>\n(.*?)\n</source>", re.S)


def _first_sentence(text: str, limit: int = 220) -> str:
    s = re.split(r"(?<=[.!?])\s", text.strip(), maxsplit=1)[0]
    return s[:limit]


class MockProvider:
    name = "mock"

    def __init__(self, model: str = "mock-1", fail: bool = False, delay: float = 0.0):
        self.model = model or "mock-1"
        self.fail = fail
        self.delay = delay
        self.calls: list[list[ChatMessage]] = []

    def _answer(self, messages: list[ChatMessage]) -> str:
        user = messages[-1].content
        system = messages[0].content if messages and messages[0].role == "system" else ""
        sources = _SOURCE_RE.findall(user)
        if "FOLLOW_UP_TASK" in user:
            return "1. What methods were used?\n2. What are the main limitations?\n3. How do the findings compare?"
        if "QUESTIONS_TASK" in user:
            return "1. What problem does this work address?\n2. How robust are the results?\n3. What remains unexplored?"
        if not sources:
            return "**Insufficient evidence:** the provided sources do not contain enough information."
        lines = [f"{_first_sentence(text)} [{sid}]" for sid, text in sources[:3]]
        if "MODE: research" in system:
            return (
                "## Summary\n"
                + lines[0]
                + "\n\n## Key Findings\n"
                + "\n".join(f"- {ln}" for ln in lines)
                + "\n\n## Evidence\n"
                + "\n".join(f"- {ln}" for ln in lines)
                + "\n\n## Disagreements\n- **Insufficient evidence:** no explicit disagreement found.\n\n"
                "## Limitations\n- **Interpretation:** based only on the retrieved excerpts.\n\n"
                "## Open Questions\n- What further evidence would strengthen these findings?"
            )
        if "MODE: synthesis" in system or "TASK: compare" in user:
            return "## Agreements\n" + lines[0] + "\n\n## Differences\n" + "\n".join(f"- {ln}" for ln in lines[1:] or lines)
        return (
            "Based on the sources:\n\n"
            + "\n".join(f"- {ln}" for ln in lines)
            + "\n\n**Interpretation:** these excerpts are directly relevant."
        )

    async def complete(self, messages, *, temperature=0.0, max_tokens=0) -> str:
        self.calls.append(messages)
        if self.fail:
            from app.core.errors import ProviderError

            raise ProviderError("Mock provider failure", code="provider_timeout")
        if self.delay:
            await asyncio.sleep(self.delay)
        return self._answer(messages)

    async def stream(self, messages, *, temperature=0.0, max_tokens=0) -> AsyncIterator[str]:
        self.calls.append(messages)
        if self.fail:
            from app.core.errors import ProviderError

            raise ProviderError("Mock provider failure", code="provider_timeout")
        text = self._answer(messages)
        for piece in re.findall(r"\S+\s*", text):
            if self.delay:
                await asyncio.sleep(self.delay)
            yield piece

    async def check(self) -> str:
        return "Mock provider is always available."
