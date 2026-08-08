"""Pure functions for evaluation metrics calculation."""


def compare_criterios(actual_criterios: list[dict], expected_criterios: list[dict]) -> list[dict]:
    """
    Compare actual vs expected criterios.

    Args:
        actual_criterios: List of dicts with at least {"criterio": str, "nivel": int}
        expected_criterios: List of dicts with {"criterio": str, "nivel": int}

    Returns:
        List of dicts: [{"criterio": ..., "expected_nivel": ..., "actual_nivel": ..., "exact_match": bool, "abs_error": int}, ...]
    """
    # Build map of expected by criterio name
    expected_map = {item["criterio"]: item["nivel"] for item in expected_criterios}

    # Build map of actual by criterio name
    actual_map = {item["criterio"]: item["nivel"] for item in actual_criterios}

    result = []
    # Only compare criterios that appear in both actual and expected
    for criterio_name, expected_nivel in expected_map.items():
        if criterio_name in actual_map:
            actual_nivel = actual_map[criterio_name]
            exact_match = actual_nivel == expected_nivel
            abs_error = abs(actual_nivel - expected_nivel)
            result.append(
                {
                    "criterio": criterio_name,
                    "expected_nivel": expected_nivel,
                    "actual_nivel": actual_nivel,
                    "exact_match": exact_match,
                    "abs_error": abs_error,
                }
            )

    return result


def check_over_by_2(actual_criterios: list[dict], autoevaluacion: dict[str, int]) -> list[str]:
    """
    Check if actual inflated 2+ levels over self-assessment.

    Args:
        actual_criterios: List of dicts with {"criterio": str, "nivel": int, ...}
        autoevaluacion: Dict mapping criterio name to self-assessed nivel

    Returns:
        List of criterio names that inflated 2+ levels (empty if none)
    """
    result = []
    for item in actual_criterios:
        criterio_name = item["criterio"]
        if criterio_name in autoevaluacion:
            actual_nivel = item["nivel"]
            self_assessed_nivel = autoevaluacion[criterio_name]
            if actual_nivel - self_assessed_nivel >= 2:
                result.append(criterio_name)
    return result


FORBIDDEN_PHRASES = [
    "está mal",
    "esta mal",
    "incorrecto",
    "deberías haber",
    "no supiste",
    "qué bonito",
    "que bonito",
    "muy buen trabajo",
    "excelente",
    "sigue así",
    "sigue asi",
]


def check_tone_violations(text: str) -> list[str]:
    """
    Check for forbidden phrases in text (case-insensitive).

    Args:
        text: Text to check

    Returns:
        List of forbidden phrases found in text (empty if clean)
    """
    text_lower = text.lower()
    violations = []
    for phrase in FORBIDDEN_PHRASES:
        if phrase in text_lower:
            violations.append(phrase)
    return violations
