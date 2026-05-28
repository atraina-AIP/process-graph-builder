FROM python:3.12-slim

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .

# Schemas available to the backend at /app/schema/
COPY schema/ /app/schema/

# Writable directory for JSON graph store (replaced by database in production).
RUN mkdir -p /app/data

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
