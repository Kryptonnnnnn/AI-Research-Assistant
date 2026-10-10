from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser
from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.core.ratelimit import rate_limit
from app.models import Document, ProcessingJob
from app.repositories.ownership import get_document, get_job
from app.schemas.common import Message, Page
from app.schemas.documents import ChunkOut, DocumentOut, DocumentUpdate, JobOut, JobWithDoc, UploadResponse
from app.services import document_service
from app.storage.factory import get_storage

router = APIRouter(tags=["documents"])


@router.post(
    "/documents/upload",
    response_model=UploadResponse,
    status_code=201,
    dependencies=[Depends(rate_limit("upload", "rate_limit_upload_per_minute"))],
    responses={409: {"model": UploadResponse}, 422: {"model": UploadResponse}},
)
async def upload_documents(
    user: CurrentUser, db: DB, files: Annotated[list[UploadFile], File(description="PDF, DOCX, TXT or Markdown")]
):
    s = get_settings()
    if len(files) > s.max_files_per_upload:
        raise ValidationFailed(f"You can upload at most {s.max_files_per_upload} files at once.", code="too_many_files")
    items = []
    for f in files:
        data = await f.read(s.max_upload_bytes + 1)  # bounded read: never buffer more than the limit + 1 byte
        items.append(await document_service.ingest_upload(db, user.id, f.filename or "document", f.content_type, data))
    body = UploadResponse(items=items)
    if any(i.status == "created" for i in items):
        return body
    if all(i.status == "duplicate" for i in items):
        code = 409
    elif any(i.error_code == "storage_quota_exceeded" for i in items):
        code = 507
    else:
        code = 422
    return JSONResponse(body.model_dump(mode="json"), status_code=code)


@router.get("/documents", response_model=Page[DocumentOut])
async def list_documents(
    user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_: str | None = Query(None, alias="status", pattern="^(queued|processing|ready|failed)$"),
    collection_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=200),
    sort: str = Query("newest", pattern="^(newest|oldest|title|size|popular)$"),
):
    items, total = await document_service.list_documents(
        db, user.id, page=page, page_size=page_size, status=status_, collection_id=collection_id, q=q, sort=sort
    )
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/documents/{doc_id}", response_model=DocumentOut)
async def get_doc(doc_id: uuid.UUID, user: CurrentUser, db: DB):
    doc = await get_document(db, user.id, doc_id)
    return (await document_service.attach_collections(db, [doc]))[0]


@router.patch("/documents/{doc_id}", response_model=DocumentOut)
async def update_doc(doc_id: uuid.UUID, body: DocumentUpdate, user: CurrentUser, db: DB):
    return await document_service.update_document(db, user.id, doc_id, body)


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_doc(doc_id: uuid.UUID, user: CurrentUser, db: DB):
    await document_service.delete_document(db, user.id, doc_id)
    return Response(status_code=204)


@router.post("/documents/{doc_id}/reprocess", response_model=DocumentOut, status_code=202)
async def reprocess(doc_id: uuid.UUID, user: CurrentUser, db: DB):
    doc = await document_service.reprocess_document(db, user.id, doc_id)
    return (await document_service.attach_collections(db, [doc]))[0]


@router.post("/documents/reprocess-all", response_model=Message, status_code=202)
async def reprocess_all(user: CurrentUser, db: DB):
    n = await document_service.reprocess_all(db, user.id)
    return Message(message=f"Queued {n} document(s) for reprocessing.")


@router.get("/documents/{doc_id}/chunks", response_model=list[ChunkOut])
async def chunks(
    doc_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    page_number: int | None = Query(None, ge=1),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return await document_service.document_chunks(db, user.id, doc_id, page_number, limit, offset)


@router.get("/documents/{doc_id}/file")
async def download(doc_id: uuid.UUID, user: CurrentUser, db: DB, download: bool = False):
    doc = await get_document(db, user.id, doc_id)
    data = await get_storage().read(doc.storage_key)
    safe = doc.original_filename.encode("ascii", "ignore").decode() or "document"
    inline = doc.file_ext == ".pdf" and not download
    return Response(
        data,
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{safe}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
        },
    )


@router.get("/jobs", response_model=Page[JobWithDoc])
async def list_jobs(
    user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_: str | None = Query(None, alias="status", pattern="^(queued|running|succeeded|failed)$"),
):
    cond = [ProcessingJob.user_id == user.id] + ([ProcessingJob.status == status_] if status_ else [])
    total = (await db.execute(select(func.count()).select_from(ProcessingJob).where(*cond))).scalar_one()
    rows = (
        await db.execute(
            select(ProcessingJob, Document.title)
            .join(Document, Document.id == ProcessingJob.document_id)
            .where(*cond)
            .order_by(ProcessingJob.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = []
    for job, title in rows:
        o = JobWithDoc.model_validate(job)
        o.document_title = title
        items.append(o)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job_status(job_id: uuid.UUID, user: CurrentUser, db: DB):
    return await get_job(db, user.id, job_id)
