import json
import sys
from pathlib import Path
import importlib.util

import pytest
from pydantic import ValidationError

# Dynamically load the RubricOutput model from the generated file
rubric_models_path = Path(__file__).parent.parent.parent.parent / "packages" / "rubric" / "generated" / "rubric_models.py"
spec = importlib.util.spec_from_file_location("rubric_models", rubric_models_path)
rubric_models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rubric_models)
RubricOutput = rubric_models.RubricOutput
# Rebuild model to ensure all forward references are resolved
# Pass the module's namespace to resolve type annotations
RubricOutput.model_rebuild(_types_namespace=vars(rubric_models))


class TestRubricRoundtrip:
    @pytest.fixture
    def valid_data(self):
        fixture_path = (
            Path(__file__).parent.parent.parent.parent
            / "packages"
            / "rubric"
            / "fixtures"
            / "valid-example.json"
        )
        with open(fixture_path) as f:
            return json.load(f)

    @pytest.fixture
    def invalid_data(self):
        fixture_path = (
            Path(__file__).parent.parent.parent.parent
            / "packages"
            / "rubric"
            / "fixtures"
            / "invalid-example.json"
        )
        with open(fixture_path) as f:
            return json.load(f)

    def test_valid_data_passes(self, valid_data):
        """Valid example should parse without raising ValidationError"""
        result = RubricOutput.model_validate(valid_data)
        assert result is not None

    def test_invalid_data_raises(self, invalid_data):
        """Invalid example (missing bandera_para_papa) should raise ValidationError"""
        with pytest.raises(ValidationError):
            RubricOutput.model_validate(invalid_data)
