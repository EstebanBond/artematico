"""Tests for the /evaluate endpoint."""

import io
import json
import os
import sys
from pathlib import Path

import pytest
from PIL import Image

# Set environment variables BEFORE importing main
os.environ["LLM_PROVIDER"] = "fake"
os.environ.setdefault(
    "PROMPT_PATH",
    str(
        Path(__file__).parent.parent.parent.parent
        / "prompts"
        / "evaluator.v1.md"
    ),
)
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-dummy")
os.environ.setdefault("MAX_IMAGE_LONG_EDGE", "1568")

# Add parent directory to path so we can import main
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient

# Import main after env vars are set
from main import app

# Load RubricOutput model
rubric_models_path = (
    Path(__file__).parent.parent.parent.parent
    / "packages"
    / "rubric"
    / "generated"
    / "rubric_models.py"
)
import importlib.util

spec = importlib.util.spec_from_file_location("rubric_models", rubric_models_path)
rubric_models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rubric_models)
RubricOutput = rubric_models.RubricOutput
RubricOutput.model_rebuild(_types_namespace=vars(rubric_models))


@pytest.fixture
def test_client():
    """Create a test client."""
    return TestClient(app)


@pytest.fixture
def test_image():
    """Create a test image in memory."""
    img = Image.new("RGB", (200, 200), color="blue")
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG")
    buffer.seek(0)
    return buffer


@pytest.fixture
def valid_context():
    """Create valid evaluation context."""
    return {
        "tecnica": "grafito_linea",
        "papel": "bond_75",
        "criterios_foco": ["trazo_linea"],
        "criterios_desactivados": [],
        "consigna": "Dibuja un objeto de tu casa.",
        "autoevaluacion": {"trazo_linea": 2},
        "n": 1,
        "huella_previa": [],
    }


class TestEvaluateEndpoint:
    def test_health_check(self, test_client):
        """Verify /health endpoint still works."""
        response = test_client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_evaluate_success(self, test_client, test_image, valid_context):
        """Test successful evaluation with valid image and context."""
        response = test_client.post(
            "/evaluate",
            files={"image": ("test.jpg", test_image, "image/jpeg")},
            data={"context": json.dumps(valid_context)},
        )
        assert response.status_code == 200

        # Verify response can be parsed as RubricOutput
        result = RubricOutput.model_validate(response.json())
        assert result is not None
        assert result.tecnica is not None
        assert len(result.criterios_foco) >= 1

    def test_evaluate_headers(self, test_client, test_image, valid_context):
        """Test that response headers are present."""
        response = test_client.post(
            "/evaluate",
            files={"image": ("test.jpg", test_image, "image/jpeg")},
            data={"context": json.dumps(valid_context)},
        )
        assert response.status_code == 200
        assert "X-Prompt-Sha256" in response.headers
        assert "X-Anthropic-Model" in response.headers
        assert response.headers["X-Anthropic-Model"] == "claude-sonnet-5"

    def test_evaluate_invalid_context(self, test_client, test_image):
        """Test evaluation with invalid context (missing required field)."""
        invalid_context = {
            "tecnica": "grafito_linea",
            # Missing 'papel' and other required fields
        }
        response = test_client.post(
            "/evaluate",
            files={"image": ("test.jpg", test_image, "image/jpeg")},
            data={"context": json.dumps(invalid_context)},
        )
        assert response.status_code == 400

    def test_evaluate_invalid_content_type(self, test_client, valid_context):
        """Test evaluation with invalid content type."""
        test_file = io.BytesIO(b"not an image")
        response = test_client.post(
            "/evaluate",
            files={"image": ("test.txt", test_file, "text/plain")},
            data={"context": json.dumps(valid_context)},
        )
        assert response.status_code == 400

    def test_evaluate_criteria_foco_min_length(self, test_client, test_image):
        """Test that criterios_foco requires at least 1 item."""
        invalid_context = {
            "tecnica": "grafito_linea",
            "papel": "bond_75",
            "criterios_foco": [],  # Empty list, should fail min_length=1
            "criterios_desactivados": [],
            "consigna": "Dibuja un objeto de tu casa.",
            "autoevaluacion": {},
            "n": 1,
            "huella_previa": [],
        }
        test_file = io.BytesIO()
        Image.new("RGB", (100, 100)).save(test_file, format="JPEG")
        test_file.seek(0)

        response = test_client.post(
            "/evaluate",
            files={"image": ("test.jpg", test_file, "image/jpeg")},
            data={"context": json.dumps(invalid_context)},
        )
        assert response.status_code == 400
