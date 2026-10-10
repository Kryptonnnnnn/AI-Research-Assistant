# Security

## Reporting a vulnerability
Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue. Include reproduction steps and affected version. Do not include real user data.

## Design summary
| Area | Measure |
|---|---|
| Passwords | Argon2id (`argon2-cffi`), automatic rehash on login, constant-time-ish login (dummy hash for unknown emails), strength rules |
| Sessions | Signed JWT carrying a server-side session id; every request checks the `user_sessions` row, so **logout and password change really revoke access**. Delivered as an `HttpOnly`, `SameSite=Lax`, `Secure` (prod) cookie; `Authorization: Bearer` also accepted for API clients |
| Authorization | Enforced server-side in every query (`user_id` filters / `repositories/ownership.py`). Another user's resource returns **404**, never 403, so existence is not leaked. Vector/keyword search filters by `user_id` inside the SQL itself. Covered by `tests/test_isolation.py` |
| Uploads | Extension allow-list, MIME check, magic-byte check, DOCX zip sanity/zip-bomb guard, bounded streaming read, size limit, SHA-256 dedupe, random internal filenames, path-traversal-proof storage, `nosniff` on downloads |
| Prompt injection | Retrieved text is untrusted data: wrapped in `<source>` blocks with closing-tag escaping, fixed system rules, citation labels validated against what was actually retrieved (hallucinated ids are stripped) |
| Output | AI markdown is rendered without raw HTML; links restricted to http/https/mailto |
| Abuse | In-memory sliding-window rate limits on auth, upload, chat (per client IP, per process) |
| Transport/headers | CORS limited to `CORS_ORIGINS`; production refuses to start with the default `SECRET_KEY` or wildcard CORS; `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy` |
| Secrets | Environment only; `.env` is git-ignored; API keys never returned by any endpoint or logged; request logs contain method/path/status/latency only; document text, passwords and tokens are never logged |
| Dependencies | `pip-audit` / `npm audit` in CI |

## Known limitations
- Rate limiting is per process. Behind several instances, add a shared limiter or edge rules.
- No email verification, password reset or MFA yet.
- CSRF relies on `SameSite=Lax` cookies + JSON/multipart APIs + restricted CORS; add CSRF tokens if you loosen `COOKIE_SAMESITE`.
- Files at rest are not encrypted by the app (use bucket/disk encryption).
- Uploaded PDFs are parsed with `pypdf`; parsing untrusted files always carries some risk, so run the worker with least privilege.
