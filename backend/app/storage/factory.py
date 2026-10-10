from __future__ import annotations

import logging

from app.core.config import get_settings
from app.storage.base import StorageBackend

_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        s = get_settings()
        backend = s.storage_backend
        if backend == "s3" and not s.s3_bucket:
            # Misconfiguration safety net: keep uploads working (visible in /ready) rather than failing every request.
            logging.getLogger("app.storage").warning("STORAGE_BACKEND=s3 but S3_BUCKET is empty; using database storage")
            backend = "db"
        if backend == "db":
            from app.storage.db import DatabaseStorage

            _storage = DatabaseStorage()
        elif backend == "s3":
            from app.storage.s3 import S3Storage

            _storage = S3Storage(s.s3_bucket, s.s3_endpoint_url, s.s3_region, s.s3_access_key_id, s.s3_secret_access_key)
        else:
            from app.storage.local import LocalStorage

            _storage = LocalStorage(s.storage_local_dir)
    return _storage


def set_storage(storage: StorageBackend | None) -> None:
    global _storage
    _storage = storage
