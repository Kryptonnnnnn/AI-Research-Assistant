from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response
from fastapi.responses import PlainTextResponse

from app.api.deps import DB, CurrentUser
from app.repositories.ownership import get_note
from app.schemas.chat import NoteIn, NoteOut, NoteUpdate
from app.schemas.common import Page
from app.services import note_service as svc

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=Page[NoteOut])
async def list_notes(
    user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, max_length=200),
):
    rows, total = await svc.list_notes(db, user.id, page, page_size, q)
    return Page(items=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=NoteOut, status_code=201)
async def create(body: NoteIn, user: CurrentUser, db: DB):
    return await svc.create_note(db, user.id, body)


@router.get("/{note_id}", response_model=NoteOut)
async def get(note_id: uuid.UUID, user: CurrentUser, db: DB):
    return await get_note(db, user.id, note_id)


@router.patch("/{note_id}", response_model=NoteOut)
async def update(note_id: uuid.UUID, body: NoteUpdate, user: CurrentUser, db: DB):
    return await svc.update_note(db, user.id, note_id, body)


@router.delete("/{note_id}", status_code=204)
async def delete(note_id: uuid.UUID, user: CurrentUser, db: DB):
    await svc.delete_note(db, user.id, note_id)
    return Response(status_code=204)


@router.get("/{note_id}/export", response_class=PlainTextResponse)
async def export(note_id: uuid.UUID, user: CurrentUser, db: DB):
    note = await get_note(db, user.id, note_id)
    return PlainTextResponse(
        svc.note_markdown(note),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{svc.safe_filename(note.title)}"'},
    )
