from __future__ import annotations

import asyncio
from pathlib import Path


class LocalStorage:
    """Filesystem storage. NOTE: free hosts like Render have an ephemeral disk; use S3 there."""

    name = "local"

    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):  # defence in depth against path traversal
            raise ValueError("Invalid storage key")
        return path

    async def save(self, key: str, data: bytes, content_type: str = "") -> None:
        path = self._path(key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)

        await asyncio.to_thread(_write)

    async def read(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path(key).read_bytes)

    async def delete(self, key: str) -> None:
        def _rm() -> None:
            self._path(key).unlink(missing_ok=True)

        await asyncio.to_thread(_rm)

    async def check(self) -> None:
        probe = self.root / ".healthcheck"
        await asyncio.to_thread(probe.write_bytes, b"ok")
        await asyncio.to_thread(probe.unlink)

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).exists)
