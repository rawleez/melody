FROM python:3.12-slim

WORKDIR /app

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ ./server/
COPY client/ ./client/

WORKDIR /app/server

CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
