from fastapi import APIRouter

from app.api.routers import auth, chat, collections, documents, meta, notes, research

api_router = APIRouter()
for r in (
    auth.router,
    documents.router,
    collections.router,
    chat.router,
    research.router,
    notes.router,
    meta.router,
    meta.health_router,
):
    api_router.include_router(r)
