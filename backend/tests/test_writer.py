import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import agents.writer as writer


def model_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content)
            )
        ]
    )


VALID_RESULT = {
    "subject": "A quick question",
    "body": "Hi Alex, would you be open to a short conversation? Regards, Harsh",
    "reasoning": "Uses a concise CTA.",
}


def mock_model(monkeypatch, content):
    mocked = AsyncMock(return_value=model_response(content))
    monkeypatch.setattr(writer, "run_blocking", mocked)
    return mocked


def test_valid_email_is_returned(monkeypatch):
    mock_model(monkeypatch, json.dumps(VALID_RESULT))

    result = asyncio.run(
        writer.write_email("Verified company research")
    )

    assert result == VALID_RESULT


def test_writer_passes_optional_context_to_prompt(monkeypatch):
    mocked = mock_model(monkeypatch, json.dumps(VALID_RESULT))

    asyncio.run(
        writer.write_email(
            "Verified research",
            recipient_name="Alex",
            sender_name="Harsh",
            context="Discuss API reliability",
            related_businesses="Example Corp",
        )
    )

    prompt = mocked.await_args.kwargs["messages"][0]["content"]
    assert "Alex" in prompt
    assert "Harsh" in prompt
    assert "Discuss API reliability" in prompt
    assert "Example Corp" in prompt


def test_invalid_json_is_rejected(monkeypatch):
    mock_model(monkeypatch, "not JSON")

    with pytest.raises(RuntimeError, match="invalid JSON"):
        asyncio.run(writer.write_email("Research"))


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {},
        {"subject": 123, "body": "Email body"},
        {"subject": "Subject", "body": None},
    ],
)
def test_malformed_email_output_is_rejected(monkeypatch, payload):
    mock_model(monkeypatch, json.dumps(payload))

    with pytest.raises(RuntimeError):
        asyncio.run(writer.write_email("Research"))


@pytest.mark.parametrize(
    "payload",
    [
        {"subject": "", "body": "Email body"},
        {"subject": "Subject", "body": ""},
        {"subject": "   ", "body": "Email body"},
        {"subject": "Subject", "body": "   "},
    ],
)
def test_empty_email_fields_are_rejected(monkeypatch, payload):
    mock_model(monkeypatch, json.dumps(payload))

    with pytest.raises(RuntimeError, match="non-empty"):
        asyncio.run(writer.write_email("Research"))


def test_non_string_reasoning_is_rejected(monkeypatch):
    payload = {**VALID_RESULT, "reasoning": ["unexpected", "list"]}
    mock_model(monkeypatch, json.dumps(payload))

    with pytest.raises(RuntimeError, match="reasoning"):
        asyncio.run(writer.write_email("Research"))


def test_empty_model_content_is_rejected(monkeypatch):
    mock_model(monkeypatch, model_response(None).choices[0].message.content)

    with pytest.raises(RuntimeError):
        asyncio.run(writer.write_email("Research"))


def test_invalid_response_structure_is_rejected(monkeypatch):
    mocked = AsyncMock(return_value=SimpleNamespace(choices=[]))
    monkeypatch.setattr(writer, "run_blocking", mocked)

    with pytest.raises(RuntimeError, match="invalid email draft response"):
        asyncio.run(writer.write_email("Research"))


def test_recipient_placeholder_is_replaced(monkeypatch):
    payload = {
        "subject": "A relevant subject",
        "body": "Hi [Name],\n\nLet's discuss workflow automation.",
        "reasoning": "Test reasoning",
    }
    mock_model(monkeypatch, json.dumps(payload))

    result = asyncio.run(
        writer.write_email(
            "Research",
            recipient_name="Product Engineering Lead",
        )
    )

    assert result["body"].startswith("Hi Product Engineering Lead,")
    assert "[Name]" not in result["body"]