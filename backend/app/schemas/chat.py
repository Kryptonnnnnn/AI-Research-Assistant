from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

Mode = Literal["qa", "research", "synthesis"]


class SourceOut(BaseModel):
    """A retrieved/cited source. `id` is set once persisted as a message citation."""

    id: uuid.UUID | None = None
    label: str
    chunk_id: uuid.UUID | None
    document_id: uuid.UUID | None
    document_title: str
    page_number: int | None
    section: str | None
    chunk_index: int | None
    excerpt: str
    chunk_text: str
    score: float
    vector_score: float
    keyword_score: float
    cited: bool = True


class MessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    status: str
    mode: str
    provider: str | None
    model: str | None
    error: str | None
    retrieval_meta: dict
    created_at: datetime
    citations: list[SourceOut] = []


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    conversation_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    collection_id: uuid.UUID | None = None
    mode: Mode = "qa"


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    user_message: MessageOut
    message: MessageOut


class ConversationOut(ORMModel):
    id: uuid.UUID
    title: str
    collection_id: uuid.UUID | None
    document_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    last_message_preview: str = ""


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    document_ids: list[uuid.UUID] | None = None
    collection_id: uuid.UUID | None = None


class FollowUps(BaseModel):
    suggestions: list[str]


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    collection_id: uuid.UUID | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)
    score_threshold: float | None = Field(default=None, ge=-1, le=1)


class SearchResponse(BaseModel):
    query: str
    results: list[SourceOut]
    candidates: int
    latency_ms: float


class TaskRequest(BaseModel):
    document_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    focus: str | None = Field(default=None, max_length=500)
    length: Literal["short", "medium", "detailed"] = "medium"
    count: int = Field(default=6, ge=1, le=15)


class TaskResponse(BaseModel):
    task: str
    content: str
    citations: list[SourceOut]
    provider: str
    model: str
    insufficient_evidence: bool = False


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50000)
    source_message_id: uuid.UUID | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=50000)
    tags: list[str] | None = Field(default=None, max_length=20)


class NoteOut(ORMModel):
    id: uuid.UUID
    title: str
    content: str
    source_message_id: uuid.UUID | None
    citations: list[dict]
    tags: list[str]
    created_at: datetime
    updated_at: datetime
