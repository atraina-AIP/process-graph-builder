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

COPY app/requirements.txt app/requirements-azure-sql.txt ./
RUN pip install --no-cache-dir -r requirements-azure-sql.txt

COPY app/ .

# Schemas available to the backend at /app/schema/
COPY schema/ /app/schema/

# Writable directory for JSON graph store (replaced by database in production).
RUN mkdir -p /app/data

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
