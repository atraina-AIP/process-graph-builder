FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg unixodbc \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
        > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements-azure-sql.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements-azure-sql.txt

COPY backend/ ./backend/
COPY schema/ ./schema/
COPY assets/ ./assets/
COPY index.html app.js styles.css ./

RUN mkdir -p /app/backend/data

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV PROCESS_GRAPH_STATIC_DIR=/app

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]