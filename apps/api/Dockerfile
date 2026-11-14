# Baton API (FastAPI). Build from the repo root:  docker compose --profile full up --build
# The image mirrors the repo layout (apps/api + demo) because the demo loader finds demo/ relative to the code.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app/apps/api

COPY apps/api/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt "uvicorn[standard]==0.54.0"

COPY apps/api/ /app/apps/api/
COPY demo/ /app/demo/

RUN useradd --create-home baton && chown -R baton /app
USER baton

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=10 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health').status==200 else 1)"
CMD ["sh", "/app/apps/api/docker-entrypoint.sh"]
