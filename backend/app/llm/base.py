from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol


@dataclass
class ChatMessage:
    role: str  # system | user | assistant
    content: str


class LLMProvider(Protocol):
    name: str
    model: str

    async def complete(self, messages: list[ChatMessage], *, temperature: float, max_tokens: int) -> str: ...

    def stream(self, messages: list[ChatMessage], *, temperature: float, max_tokens: int) -> AsyncIterator[str]: ...

    async def check(self) -> str:
        """Cheap connectivity probe. Returns a human-readable status or raises ProviderError."""
        ...
