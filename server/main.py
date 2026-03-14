import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# API routes are registered here (future issues)

# Static files — mounted last so API routes take priority
_client_dir = os.path.join(os.path.dirname(__file__), "..", "client")
app.mount("/", StaticFiles(directory=_client_dir, html=True), name="static")
