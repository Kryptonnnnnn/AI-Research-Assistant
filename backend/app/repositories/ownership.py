"""Ownership-enforcing lookups. Every route that touches user data goes through these.

A resource owned by someone else is reported as 404 (not 403) so its existence is not leaked.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models import Collection, Conversation, Document, Message, ProcessingJob, ResearchNote


async def _get_owned(db: AsyncSession, model, user_id: uuid.UUID, obj_id: uuid.UUID, label: str):
    obj = (await db.execute(select(model).where(model.id == obj_id, model.user_id == user_id))).scalar_one_or_none()
    if obj is None:
        raise NotFoundError(f"{label} not found")
    return obj


async def get_document(db, user_id, doc_id) -> Document:
    return await _get_owned(db, Document, user_id, doc_id, "Document")


async def get_collection(db, user_id, collection_id) -> Collection:
    return await _get_owned(db, Collection, user_id, collection_id, "Collection")


async def get_conversation(db, user_id, conversation_id) -> Conversation:
    return await _get_owned(db, Conversation, user_id, conversation_id, "Conversation")


async def get_message(db, user_id, message_id) -> Message:
    return await _get_owned(db, Message, user_id, message_id, "Message")


async def get_note(db, user_id, note_id) -> ResearchNote:
    return await _get_owned(db, ResearchNote, user_id, note_id, "Note")


async def get_job(db, user_id, job_id) -> ProcessingJob:
    return await _get_owned(db, ProcessingJob, user_id, job_id, "Job")
