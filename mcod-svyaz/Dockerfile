FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run typecheck && npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY backend/app/ ./backend/app/
COPY configs/ ./configs/
COPY --from=frontend /build/dist/ ./frontend/dist/
ENV PYTHONPATH=/app/backend PYTHONUNBUFFERED=1 MCOD_DB=/data/mcod.sqlite3
RUN useradd --system --uid 10001 --create-home mcod && mkdir /data && chown mcod /data
USER mcod
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
