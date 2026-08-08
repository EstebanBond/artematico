"""Run evaluations against golden set."""

import argparse
import base64
import glob
import json
import os
import sys
from pathlib import Path
from typing import Any
import importlib.util

from .metrics import check_over_by_2, check_tone_violations, compare_criterios


def _parse_llm_json(raw: str) -> dict[str, Any]:
    """Parse JSON from LLM response, handling markdown wrapping."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def load_rubric_models(schema_path: str):
    """Dynamically load RubricOutput model from schema path."""
    rubric_models_path = Path(schema_path).parent / "generated" / "rubric_models.py"
    spec = importlib.util.spec_from_file_location("rubric_models", rubric_models_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load rubric models from {rubric_models_path}")
    rubric_models = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rubric_models)
    RubricOutput = rubric_models.RubricOutput
    RubricOutput.model_rebuild(_types_namespace=vars(rubric_models))
    return RubricOutput


def find_image_in_dir(case_dir: Path) -> Path | None:
    """Find first image file in directory (image.jpg, image.png, etc.)."""
    for pattern in ["image.jpg", "image.jpeg", "image.png", "image.webp"]:
        matches = glob.glob(str(case_dir / pattern), recursive=False)
        if matches:
            return Path(matches[0])
    return None


def process_case(
    case_dir: Path,
    RubricOutput,
    prompt_path: str,
) -> dict[str, Any]:
    """Process a single test case."""
    from llm_provider import get_provider
    from prompt_template import render_prompt
    from image_processing import resize_for_anthropic

    case_id = case_dir.name

    # Read image
    image_path = find_image_in_dir(case_dir)
    if not image_path:
        raise FileNotFoundError(f"No image found in {case_dir}")

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    # Read input.json
    input_path = case_dir / "input.json"
    with open(input_path, "r") as f:
        input_context = json.load(f)

    # Read expected.json
    expected_path = case_dir / "expected.json"
    with open(expected_path, "r") as f:
        expected = json.load(f)

    # Process image
    jpeg_bytes, media_type = resize_for_anthropic(
        image_bytes, int(os.environ.get("MAX_IMAGE_LONG_EDGE", "1568"))
    )
    image_b64 = base64.b64encode(jpeg_bytes).decode("ascii")

    # Render prompt
    system_prompt, _ = render_prompt(prompt_path, input_context)

    # Get provider and call
    provider = get_provider()
    raw = provider.evaluate(system_prompt=system_prompt, image_b64=image_b64, media_type=media_type)

    # Parse and validate
    parsed = _parse_llm_json(raw)
    actual = RubricOutput.model_validate(parsed)

    # Compare criterios
    actual_criterios_list = [
        {"criterio": c.criterio.value, "nivel": c.nivel} for c in actual.criterios_foco
    ]
    per_criterio = compare_criterios(actual_criterios_list, expected["criterios_foco"])

    # Check over_by_2
    over_by_2_criteria = check_over_by_2(actual_criterios_list, input_context.get("autoevaluacion", {}))

    # Check tone violations in both lo_que_funciona and lo_que_sigue
    tone_violations = []
    tone_violations.extend(check_tone_violations(actual.lo_que_funciona))
    tone_violations.extend(check_tone_violations(actual.lo_que_sigue))

    return {
        "case_id": case_id,
        "per_criterio": per_criterio,
        "over_by_2_criteria": over_by_2_criteria,
        "tone_violations": tone_violations,
    }


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(description="Run evaluations against golden set")
    parser.add_argument("--golden", required=True, help="Path to golden set directory")
    parser.add_argument("--schema", required=True, help="Path to rubric.schema.json")
    parser.add_argument("--out", required=True, help="Path to output JSON report")
    args = parser.parse_args()

    golden_path = Path(args.golden)
    schema_path = Path(args.schema)
    out_path = Path(args.out)

    prompt_path = os.environ.get("PROMPT_PATH")
    if not prompt_path:
        print("Error: PROMPT_PATH environment variable not set", file=sys.stderr)
        sys.exit(1)

    # Load RubricOutput model
    RubricOutput = load_rubric_models(str(schema_path))

    # Check if golden set exists and has cases
    if not golden_path.exists():
        print(f"Warning: golden set not found at {golden_path}, nothing to evaluate")
        report = {
            "summary": {
                "exact_match": 1.0,
                "mae": 0.0,
                "over_by_2": 0,
                "tone_violations": 0,
                "total_cases": 0,
                "total_criteria_pairs": 0,
            },
            "cases": [],
        }
        with open(out_path, "w") as f:
            json.dump(report, f, indent=2)
        print("\nSummary:")
        print("  exact_match: 1.0")
        print("  mae: 0.0")
        print("  over_by_2: 0")
        print("  tone_violations: 0")
        return

    case_dirs = sorted([d for d in golden_path.iterdir() if d.is_dir()])
    if not case_dirs:
        print(f"Warning: no case directories found in {golden_path}, nothing to evaluate")
        report = {
            "summary": {
                "exact_match": 1.0,
                "mae": 0.0,
                "over_by_2": 0,
                "tone_violations": 0,
                "total_cases": 0,
                "total_criteria_pairs": 0,
            },
            "cases": [],
        }
        with open(out_path, "w") as f:
            json.dump(report, f, indent=2)
        print("\nSummary:")
        print("  exact_match: 1.0")
        print("  mae: 0.0")
        print("  over_by_2: 0")
        print("  tone_violations: 0")
        return

    # Process all cases
    cases = []
    all_criterio_pairs = []
    total_over_by_2 = 0
    total_tone_violations = 0

    for case_dir in case_dirs:
        try:
            case_result = process_case(case_dir, RubricOutput, prompt_path)
            cases.append(case_result)

            # Collect for summary
            all_criterio_pairs.extend(case_result["per_criterio"])
            total_over_by_2 += len(case_result["over_by_2_criteria"])
            total_tone_violations += len(case_result["tone_violations"])

        except Exception as e:
            print(f"Error processing {case_dir.name}: {e}", file=sys.stderr)
            raise

    # Calculate summary metrics
    if all_criterio_pairs:
        exact_match_count = sum(1 for pair in all_criterio_pairs if pair["exact_match"])
        exact_match = exact_match_count / len(all_criterio_pairs)
        mae = sum(pair["abs_error"] for pair in all_criterio_pairs) / len(all_criterio_pairs)
    else:
        exact_match = 1.0
        mae = 0.0

    summary = {
        # Redondeo a 4 decimales, no 2: el gate compara este valor directo contra
        # umbrales como 0.70/0.40, y redondear a 2 decimales podía mover un valor
        # límite (ej. 0.695) al otro lado del umbral solo por el redondeo.
        "exact_match": round(exact_match, 4),
        "mae": round(mae, 4),
        "over_by_2": total_over_by_2,
        "tone_violations": total_tone_violations,
        "total_cases": len(cases),
        "total_criteria_pairs": len(all_criterio_pairs),
    }

    report = {
        "summary": summary,
        "cases": cases,
    }

    # Write report
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)

    # Print summary to stdout
    print("\nSummary:")
    print(f"  exact_match: {summary['exact_match']}")
    print(f"  mae: {summary['mae']}")
    print(f"  over_by_2: {summary['over_by_2']}")
    print(f"  tone_violations: {summary['tone_violations']}")


if __name__ == "__main__":
    main()
