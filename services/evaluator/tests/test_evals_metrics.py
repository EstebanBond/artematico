"""Unit tests for evaluation metrics."""

import sys
from pathlib import Path

# Add evals package to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from evals.metrics import check_over_by_2, check_tone_violations, compare_criterios


class TestCompareCriterios:
    """Tests for compare_criterios function."""

    def test_exact_match(self):
        """Test case where actual matches expected exactly."""
        actual = [{"criterio": "trazo_linea", "nivel": 2}]
        expected = [{"criterio": "trazo_linea", "nivel": 2}]
        result = compare_criterios(actual, expected)
        assert len(result) == 1
        assert result[0]["exact_match"] is True
        assert result[0]["abs_error"] == 0

    def test_with_difference(self):
        """Test case where actual differs from expected."""
        actual = [{"criterio": "trazo_linea", "nivel": 3}]
        expected = [{"criterio": "trazo_linea", "nivel": 2}]
        result = compare_criterios(actual, expected)
        assert len(result) == 1
        assert result[0]["exact_match"] is False
        assert result[0]["abs_error"] == 1

    def test_expected_criterio_not_in_actual(self):
        """Test case where expected has criterio not in actual (should be ignored)."""
        actual = [{"criterio": "trazo_linea", "nivel": 2}]
        expected = [
            {"criterio": "trazo_linea", "nivel": 2},
            {"criterio": "proporcion_escala", "nivel": 3},
        ]
        result = compare_criterios(actual, expected)
        # Only trazo_linea should be in result since proporcion_escala is not in actual
        assert len(result) == 1
        assert result[0]["criterio"] == "trazo_linea"

    def test_multiple_criterios(self):
        """Test with multiple criterios."""
        actual = [
            {"criterio": "trazo_linea", "nivel": 2},
            {"criterio": "proporcion_escala", "nivel": 3},
        ]
        expected = [
            {"criterio": "trazo_linea", "nivel": 2},
            {"criterio": "proporcion_escala", "nivel": 2},
        ]
        result = compare_criterios(actual, expected)
        assert len(result) == 2
        assert result[0]["exact_match"] is True  # trazo_linea matches
        assert result[1]["exact_match"] is False  # proporcion_escala differs


class TestCheckOverBy2:
    """Tests for check_over_by_2 function."""

    def test_over_by_2_detected(self):
        """Test case where actual inflated 2+ levels."""
        actual = [{"criterio": "trazo_linea", "nivel": 4}]
        autoevaluacion = {"trazo_linea": 2}
        result = check_over_by_2(actual, autoevaluacion)
        assert "trazo_linea" in result

    def test_over_by_1_not_detected(self):
        """Test case where actual only inflated 1 level (should not be detected)."""
        actual = [{"criterio": "trazo_linea", "nivel": 3}]
        autoevaluacion = {"trazo_linea": 2}
        result = check_over_by_2(actual, autoevaluacion)
        assert "trazo_linea" not in result

    def test_criterio_not_in_autoevaluacion(self):
        """Test case where criterio is not in autoevaluacion (should be ignored, no crash)."""
        actual = [{"criterio": "trazo_linea", "nivel": 4}]
        autoevaluacion = {"proporcion_escala": 2}
        result = check_over_by_2(actual, autoevaluacion)
        # trazo_linea is not in autoevaluacion, so no over_by_2 detected
        assert "trazo_linea" not in result

    def test_multiple_criterios_mixed(self):
        """Test with multiple criterios, some over_by_2 some not."""
        actual = [
            {"criterio": "trazo_linea", "nivel": 4},
            {"criterio": "proporcion_escala", "nivel": 3},
        ]
        autoevaluacion = {"trazo_linea": 2, "proporcion_escala": 3}
        result = check_over_by_2(actual, autoevaluacion)
        assert "trazo_linea" in result  # 4 - 2 = 2 >= 2
        assert "proporcion_escala" not in result  # 3 - 3 = 0 < 2


class TestCheckToneViolations:
    """Tests for check_tone_violations function."""

    def test_multiple_violations_detected(self):
        """Test text with multiple forbidden phrases."""
        text = "Excelente trabajo, sigue así con lo que viene."
        result = check_tone_violations(text)
        assert len(result) >= 2  # Should find at least "excelente" and "sigue así"
        assert "excelente" in result
        assert "sigue así" in result

    def test_clean_text(self):
        """Test text with no forbidden phrases."""
        text = "El trazo del brazo derecho tiene varios repasos, se nota titubeo en la línea."
        result = check_tone_violations(text)
        assert len(result) == 0

    def test_case_insensitive(self):
        """Test that detection is case-insensitive."""
        text = "EXCELENTE trabajo"
        result = check_tone_violations(text)
        assert "excelente" in result

    def test_partial_phrase_not_matched(self):
        """Test that we match exact phrases (case-insensitive but whole phrase)."""
        text = "El trazo está increíble"
        result = check_tone_violations(text)
        # "está" should not match "está mal", "está" alone should not trigger
        assert len(result) == 0

    def test_single_violation(self):
        """Test text with single forbidden phrase."""
        text = "Está mal el trazo aquí."
        result = check_tone_violations(text)
        assert "está mal" in result
