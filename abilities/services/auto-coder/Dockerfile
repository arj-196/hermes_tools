FROM python:3.12-slim

ARG CODEX_VERSION=0.128.0

ENV PYTHONUNBUFFERED=1
ENV UV_PROJECT_ENVIRONMENT=/tmp/robin-uv-env

RUN apt-get update \
  && apt-get install -y --no-install-recommends git nodejs npm ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir \
  "loguru>=0.7.3,<1.0.0" \
  "typer>=0.20.0,<1.0.0" \
  "uv>=0.9.0,<1.0.0"

RUN npm install -g "@openai/codex@${CODEX_VERSION}"

WORKDIR /workspace
