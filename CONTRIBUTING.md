# Contributing

1. Fork, create a branch, make focused changes.
2. Backend (from `backend/`): `pip install -r requirements-dev.txt`, then `ruff check app tests migrations && ruff format app tests && mypy app && pytest`.
   Also run `TEST_DATABASE_URL=postgresql+asyncpg://ara:ara_dev_password@localhost:5432/ara_test pytest` when touching queries, models or migrations (`docker compose up -d db`).
3. Frontend (from `frontend/`): `npm run lint && npm run typecheck && npm test`; `npm run test:e2e` for UI flows.
4. Schema changes need an Alembic migration (`alembic revision --autogenerate -m "..."`, then review it) and `alembic check` must pass.
5. New user-owned resources must go through `repositories/ownership.py` and get a cross-user test in `tests/test_isolation.py`.
6. Tests must not need internet or paid APIs; put those under `tests/live` (`-m live`).
7. Never commit secrets. Keep PRs small and describe how you tested them.
