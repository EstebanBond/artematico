"""Regression tests for AnthropicProvider's retry gating.

Bug history: the retry decorator originally matched on `(Exception,)`,
which retried EVERY error including 4xx (bad request, auth) that will
never succeed on retry. These tests pin the intended behavior: retry on
transient errors, fail fast on client errors.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import anthropic
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_provider import AnthropicProvider


def _request() -> httpx.Request:
    return httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _rate_limit_error() -> anthropic.RateLimitError:
    response = httpx.Response(status_code=429, request=_request())
    return anthropic.RateLimitError("rate limited", response=response, body=None)


def _bad_request_error() -> anthropic.BadRequestError:
    response = httpx.Response(status_code=400, request=_request())
    return anthropic.BadRequestError("bad request", response=response, body=None)


def _fake_success_message() -> MagicMock:
    # type="text" explícito: AnthropicProvider.evaluate ya no asume que
    # content[0] es el texto (este modelo puede anteponer un ThinkingBlock),
    # busca el primer bloque con type == "text".
    message = MagicMock()
    message.content = [MagicMock(type="text", text='{"ok": true}')]
    return message


def test_retries_on_rate_limit_then_succeeds():
    provider = AnthropicProvider(api_key="sk-ant-test", model="claude-sonnet-5")
    call_count = {"n": 0}

    def side_effect(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] < 3:
            raise _rate_limit_error()
        return _fake_success_message()

    with patch("anthropic.Anthropic") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = side_effect
        mock_client_cls.return_value = mock_client

        result = provider.evaluate(
            system_prompt="sys", image_b64="YQ==", media_type="image/jpeg"
        )

    assert result == '{"ok": true}'
    assert call_count["n"] == 3


def test_does_not_retry_bad_request():
    provider = AnthropicProvider(api_key="sk-ant-test", model="claude-sonnet-5")
    call_count = {"n": 0}

    def side_effect(*args, **kwargs):
        call_count["n"] += 1
        raise _bad_request_error()

    with patch("anthropic.Anthropic") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = side_effect
        mock_client_cls.return_value = mock_client

        with pytest.raises(anthropic.BadRequestError):
            provider.evaluate(
                system_prompt="sys", image_b64="YQ==", media_type="image/jpeg"
            )

    assert call_count["n"] == 1
