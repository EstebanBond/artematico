"""Prompt template rendering."""

import hashlib
from typing import Any


def render_prompt(prompt_path: str, context: dict[str, Any]) -> tuple[str, str]:
    """
    Render prompt template with context and return hash.

    Args:
        prompt_path: Path to prompt template file
        context: Dictionary with template variables

    Returns:
        Tuple of (rendered_prompt, sha256_hash)
    """
    # Read raw file
    with open(prompt_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Calculate hash of raw content
    hash_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()

    # Prepare substitution values
    substitutions = {}
    for key, value in context.items():
        if isinstance(value, list):
            # Join lists with ", "
            substitutions[f"{{{{{key}}}}}"] = ", ".join(str(v) for v in value)
        elif isinstance(value, dict):
            # Format dicts as "key: value, key2: value2"
            parts = [f"{k}: {v}" for k, v in value.items()]
            substitutions[f"{{{{{key}}}}}"] = ", ".join(parts)
        else:
            # Convert to string
            substitutions[f"{{{{{key}}}}}"] = str(value)

    # Perform substitutions
    rendered = content
    for placeholder, value in substitutions.items():
        rendered = rendered.replace(placeholder, value)

    return rendered, hash_sha256
