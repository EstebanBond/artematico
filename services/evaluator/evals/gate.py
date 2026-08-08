"""Gate script to validate evaluation metrics against thresholds."""

import json
import sys
from pathlib import Path


def main():
    """Main CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: python -m evals.gate <report.json>", file=sys.stderr)
        sys.exit(1)

    report_path = Path(sys.argv[1])

    with open(report_path, "r") as f:
        report = json.load(f)

    summary = report["summary"]

    # Thresholds
    EXACT_MATCH_MIN = 0.70
    MAE_MAX = 0.40
    OVER_BY_2_MAX = 0
    TONE_VIOLATIONS_MAX = 0

    exact_match = summary["exact_match"]
    mae = summary["mae"]
    over_by_2 = summary["over_by_2"]
    tone_violations = summary["tone_violations"]

    # Check each threshold
    checks = [
        ("exact_match", exact_match >= EXACT_MATCH_MIN, f"{exact_match} >= {EXACT_MATCH_MIN}"),
        ("mae", mae <= MAE_MAX, f"{mae} <= {MAE_MAX}"),
        ("over_by_2", over_by_2 == OVER_BY_2_MAX, f"{over_by_2} == {OVER_BY_2_MAX}"),
        (
            "tone_violations",
            tone_violations == TONE_VIOLATIONS_MAX,
            f"{tone_violations} == {TONE_VIOLATIONS_MAX}",
        ),
    ]

    all_passed = True
    for name, passed, detail in checks:
        symbol = "✓" if passed else "✗"
        print(f"{symbol} {name}: {detail}")
        if not passed:
            all_passed = False

    if all_passed:
        print("\nTodos los umbrales pasaron.")
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
