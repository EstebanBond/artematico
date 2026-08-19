"""Evaluator service: stateless FastAPI app for drawing evaluations."""

import base64
import hashlib
import json
import os
import sys
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from image_processing import resize_for_anthropic, validate_upload
from llm_provider import get_provider
from prompt_template import render_prompt
from schemas import EvaluationContext

from paths import rubric_dir

sys.path.insert(0, str(rubric_dir() / "generated"))
from rubric_models import RubricOutput  # noqa: E402

app = FastAPI(title="taller-evaluator", version="0.1.0")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


def _parse_llm_json(raw: str) -> dict[str, Any]:
    """Parse JSON from LLM response, handling markdown wrapping."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


@app.post("/evaluate")
async def evaluate(image: UploadFile = File(...), context: str = Form(...)):
    """
    Evaluate a drawing submission.

    Args:
        image: JPEG/PNG/WebP image file (max 12 MB)
        context: JSON string with EvaluationContext

    Returns:
        RubricOutput JSON with evaluation and metadata headers
    """
    # Read image data
    image_bytes = await image.read()

    # Validate inputs
    try:
        validate_upload(image.content_type, len(image_bytes))
        ctx = EvaluationContext.model_validate_json(context)
    except (ValueError, ValidationError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Process image
    jpeg_bytes, media_type = resize_for_anthropic(
        image_bytes, int(os.environ.get("MAX_IMAGE_LONG_EDGE", "1568"))
    )
    image_b64 = base64.b64encode(jpeg_bytes).decode("ascii")

    # Render prompt. formato_ejemplo le da al modelo la estructura EXACTA de
    # salida (mismo fixture que usa FakeProvider en tests) — sin esto, el
    # prompt solo dice "válido contra rubric.schema.json" por nombre sin
    # mostrárselo, y el modelo adivina nombres de campo (encontrado en
    # producción: mandó "criterios_evaluados" en vez de "criterios_foco").
    prompt_context = ctx.model_dump()
    with open(rubric_dir() / "fixtures" / "valid-example.json", "r", encoding="utf-8") as f:
        prompt_context["formato_ejemplo"] = f.read().strip()
    system_prompt, prompt_hash = render_prompt(
        os.environ["PROMPT_PATH"], prompt_context
    )

    # Get provider and call
    provider = get_provider()

    def _call_and_validate() -> RubricOutput:
        """Call provider and validate response."""
        raw = provider.evaluate(
            system_prompt=system_prompt, image_b64=image_b64, media_type=media_type
        )
        parsed = _parse_llm_json(raw)
        return RubricOutput.model_validate(parsed)

    try:
        result = _call_and_validate()
    except (json.JSONDecodeError, ValidationError):
        try:
            # One retry on invalid output
            result = _call_and_validate()
        except (json.JSONDecodeError, ValidationError) as e:
            raise HTTPException(
                status_code=502,
                detail=f"Respuesta del modelo no válida contra el schema: {e}",
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error llamando al proveedor LLM: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error llamando al proveedor LLM: {e}")

    return JSONResponse(
        content=result.model_dump(mode="json"),
        headers={
            "X-Prompt-Sha256": prompt_hash,
            "X-Anthropic-Model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
        },
    )
