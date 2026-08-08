"""Helpers to locate the mounted packages/rubric directory.

En Docker, packages/rubric se monta como bind mount en /app/rubric (ver
docker-compose.yml) y RUBRIC_SCHEMA_PATH apunta ahí dentro. Localmente
(ej. corriendo pytest sin Docker) esa env var puede no estar seteada, así
que cae al layout relativo del repo.
"""

import os
from pathlib import Path

_DEFAULT_SCHEMA_PATH = (
    Path(__file__).parent.parent.parent / "packages" / "rubric" / "rubric.schema.json"
)


def rubric_dir() -> Path:
    """Directorio que contiene rubric.schema.json, fixtures/ y generated/."""
    schema_path = Path(os.environ.get("RUBRIC_SCHEMA_PATH", str(_DEFAULT_SCHEMA_PATH)))
    return schema_path.parent
