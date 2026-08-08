# Build stage with uv
FROM python:3.12-slim as builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock* ./

RUN uv sync --frozen --no-dev

# Runtime stage
FROM python:3.12-slim

WORKDIR /app

# Copy the virtual environment from the builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code (todo lo que main.py importa, no solo main.py)
COPY *.py ./

# Set environment to use the virtual environment
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Use shell form to allow WEB_CONCURRENCY expansion
CMD python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-1}
