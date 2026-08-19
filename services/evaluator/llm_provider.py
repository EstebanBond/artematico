"""LLM provider abstraction for evaluation inference."""

import os
from typing import Protocol

import anthropic
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

_RETRYABLE_ANTHROPIC_ERRORS = (
    anthropic.APIConnectionError,
    anthropic.RateLimitError,
    anthropic.InternalServerError,
)


class LLMProvider(Protocol):
    """Protocol for LLM providers."""

    def evaluate(
        self, *, system_prompt: str, image_b64: str, media_type: str
    ) -> str:
        """
        Evaluate an image and return the raw response text.

        Args:
            system_prompt: System prompt for the evaluation
            image_b64: Base64-encoded image data
            media_type: MIME type of the image (e.g., "image/jpeg")

        Returns:
            Raw response text (should be JSON, possibly with markdown wrapping)
        """
        ...


class AnthropicProvider:
    """Anthropic Claude implementation of LLMProvider."""

    def __init__(self, api_key: str, model: str):
        """Initialize Anthropic provider."""
        self.api_key = api_key
        self.model = model

    @retry(
        retry=retry_if_exception_type(_RETRYABLE_ANTHROPIC_ERRORS),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )
    def evaluate(
        self, *, system_prompt: str, image_b64: str, media_type: str
    ) -> str:
        """Evaluate image using Anthropic Claude. Retries only on transient
        errors (connection, rate limit, 5xx); fails fast on 4xx (bad
        request, auth) because retrying those wastes attempts on an error
        that will never succeed."""
        client = anthropic.Anthropic(api_key=self.api_key)

        # `temperature` ya no se manda: Anthropic la deprecó para los modelos
        # nuevos (claude-sonnet-5 la rechaza con 400 "temperature is
        # deprecated for this model") — mandarla tumbaba el 100% de las
        # evaluaciones. El modelo usa su temperatura por defecto; sigue
        # habiendo trazabilidad vía el hash del prompt (X-Prompt-Sha256).
        # max_tokens sube de 1500 a 4096: este modelo a veces antepone un
        # bloque de razonamiento (ThinkingBlock) antes de la respuesta, y con
        # 1500 el presupuesto se agotaba a mitad del razonamiento sin llegar
        # a escribir el JSON — la respuesta llegaba sin ningún bloque de
        # texto. 4096 deja margen de sobra para pensar + la respuesta.
        response = client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Evalúa este dibujo según las instrucciones del system prompt.",
                        },
                    ],
                }
            ],
        )
        # No asumir que content[0] es el texto: este modelo puede anteponer
        # un ThinkingBlock (su razonamiento interno) antes del TextBlock de
        # verdad — response.content[0].text truena con
        # "'ThinkingBlock' object has no attribute 'text'" cuando eso pasa.
        for block in response.content:
            if block.type == "text":
                return block.text
        raise ValueError("La respuesta de Claude no incluyó ningún bloque de texto")


class FakeProvider:
    """Fake provider for testing (reads fixture file)."""

    def __init__(self):
        """Initialize fake provider."""
        pass

    def evaluate(
        self, *, system_prompt: str, image_b64: str, media_type: str
    ) -> str:
        """Return fixture JSON as-is (ignores arguments)."""
        from paths import rubric_dir

        fixture_path = rubric_dir() / "fixtures" / "valid-example.json"
        with open(fixture_path, "r") as f:
            return f.read()


def get_provider() -> LLMProvider:
    """Get LLM provider based on environment."""
    provider_name = os.environ.get("LLM_PROVIDER", "anthropic")

    if provider_name == "fake":
        return FakeProvider()
    elif provider_name == "anthropic":
        api_key = os.environ["ANTHROPIC_API_KEY"]
        model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
        return AnthropicProvider(api_key=api_key, model=model)
    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {provider_name}")
