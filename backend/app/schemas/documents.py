from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class DocumentOut(ORMModel):
    id: uuid.UUID
    title: str
    original_filename: str
    file_ext: str
    mime_type: str
    size_bytes: int
    page_count: int | None
    chunk_count: int
    status: str
    progress: int
    stage: str
    error_message: str | None
    access_count: int
    last_accessed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    collection_ids: list[uuid.UUID] = []


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    collection_ids: list[uuid.UUID] | None = None


class UploadItem(BaseModel):
    filename: str
    status: str  # created | duplicate | rejected
    document: DocumentOut | None = None
    existing_document_id: uuid.UUID | None = None
    error: str | None = None
    error_code: str | None = None


class UploadResponse(BaseModel):
    items: list[UploadItem]


class ChunkOut(ORMModel):
    id: uuid.UUID
    chunk_index: int
    text: str
    page_number: int | None
    section: str | None
    token_count: int


class JobOut(ORMModel):
    id: uuid.UUID
    document_id: uuid.UUID
    kind: str
    status: str
    attempts: int
    max_attempts: int
    progress: int
    stage: str
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class JobWithDoc(JobOut):
    document_title: str | None = None


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class CollectionOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str
    document_count: int = 0
    created_at: datetime


class AssignDocuments(BaseModel):
    document_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
