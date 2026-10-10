# Backend image (API + worker share it). Slim by default; build with --build-arg WITH_ML=1 to bundle
# sentence-transformers (adds ~1 GB for PyTorch) for local embeddings.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt requirements-ml.txt requirements-s3.txt ./
ARG WITH_ML=0
ARG WITH_S3=1
RUN pip install -r requirements.txt \
 && if [ "$WITH_ML" = "1" ]; then pip install -r requirements-ml.txt --extra-index-url https://download.pytorch.org/whl/cpu; fi \
 && if [ "$WITH_S3" = "1" ]; then pip install -r requirements-s3.txt; fi

COPY . .
RUN useradd --create-home --uid 10001 app && mkdir -p /data/uploads && chown -R app /app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://localhost:8000/health', timeout=4)" || exit 1
# Run migrations, then start the API. $PORT is provided by Render/Railway/Fly; defaults to 8000.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
