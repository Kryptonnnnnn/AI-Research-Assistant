from __future__ import annotations

from app.core.config import get_settings
from app.storage.base import StorageBackend

_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        s = get_settings()
        if s.storage_backend == "s3":
            from app.storage.s3 import S3Storage

            _storage = S3Storage(s.s3_bucket, s.s3_endpoint_url, s.s3_region, s.s3_access_key_id, s.s3_secret_access_key)
        else:
            from app.storage.local import LocalStorage

            _storage = LocalStorage(s.storage_local_dir)
    return _storage


def set_storage(storage: StorageBackend | None) -> None:
    global _storage
    _storage = storage
