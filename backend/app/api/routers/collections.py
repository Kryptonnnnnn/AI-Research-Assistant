from __future__ import annotations

import uuid

from fastapi import APIRouter, Response

from app.api.deps import DB, CurrentUser
from app.schemas.documents import AssignDocuments, CollectionIn, CollectionOut, CollectionUpdate
from app.services import collection_service as svc

router = APIRouter(prefix="/collections", tags=["collections"])


@router.get("", response_model=list[CollectionOut])
async def list_collections(user: CurrentUser, db: DB):
    return await svc.list_collections(db, user.id)


@router.post("", response_model=CollectionOut, status_code=201)
async def create(body: CollectionIn, user: CurrentUser, db: DB):
    return await svc.create_collection(db, user.id, body.name, body.description)


@router.patch("/{cid}", response_model=CollectionOut)
async def update(cid: uuid.UUID, body: CollectionUpdate, user: CurrentUser, db: DB):
    return await svc.update_collection(db, user.id, cid, body.name, body.description)


@router.delete("/{cid}", status_code=204)
async def delete(cid: uuid.UUID, user: CurrentUser, db: DB):
    await svc.delete_collection(db, user.id, cid)
    return Response(status_code=204)


@router.post("/{cid}/documents", response_model=CollectionOut)
async def add_documents(cid: uuid.UUID, body: AssignDocuments, user: CurrentUser, db: DB):
    return await svc.assign_documents(db, user.id, cid, body.document_ids)


@router.delete("/{cid}/documents", response_model=CollectionOut)
async def remove_documents(cid: uuid.UUID, body: AssignDocuments, user: CurrentUser, db: DB):
    return await svc.remove_documents(db, user.id, cid, body.document_ids)
