FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY schema/ ./schema/
COPY assets/ ./assets/
COPY index.html app.js styles.css ./

RUN mkdir -p /app/backend/data

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV PROCESS_GRAPH_STATIC_DIR=/app

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
