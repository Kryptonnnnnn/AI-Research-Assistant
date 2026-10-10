# Backend image (API + worker share it). Includes fastembed (ONNX, no PyTorch) with the MiniLM model baked in, so real
# semantic embeddings work offline and on small hosts. --build-arg WITH_ML=1 additionally bundles PyTorch sentence-transformers.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt requirements-ml.txt requirements-s3.txt requirements-fastembed.txt ./
ARG WITH_ML=0
ARG WITH_S3=1
ARG WITH_FASTEMBED=1
ARG FASTEMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2
ENV EMBEDDING_CACHE_DIR=/app/.cache/fastembed
RUN pip install -r requirements.txt \
 && if [ "$WITH_ML" = "1" ]; then pip install -r requirements-ml.txt --extra-index-url https://download.pytorch.org/whl/cpu; fi \
 && if [ "$WITH_S3" = "1" ]; then pip install -r requirements-s3.txt; fi \
 && if [ "$WITH_FASTEMBED" = "1" ]; then pip install -r requirements-fastembed.txt \
    && python -c "from fastembed import TextEmbedding; TextEmbedding('$FASTEMBED_MODEL', cache_dir='$EMBEDDING_CACHE_DIR')"; fi

COPY . .
RUN useradd --create-home --uid 10001 app && mkdir -p /data/uploads && chown -R app /app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://localhost:8000/health', timeout=4)" || exit 1
# Run migrations, then start the API. $PORT is provided by Render/Railway/Fly; defaults to 8000.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
