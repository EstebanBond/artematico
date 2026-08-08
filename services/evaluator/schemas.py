"""Request/response schemas for the evaluator."""

from pydantic import BaseModel, Field


class EvaluationContext(BaseModel):
    """Context for evaluating a drawing."""

    tecnica: str
    papel: str
    criterios_foco: list[str] = Field(min_length=1, max_length=3)
    criterios_desactivados: list[str] = []
    consigna: str
    autoevaluacion: dict[str, int] = {}
    n: int
    huella_previa: list[str] = []
