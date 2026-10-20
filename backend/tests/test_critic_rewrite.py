import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import agents.critic_rewrite as critic


def model_response(content):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


VALID_RESULT = {
    "scores": {"personalization": 8, "clarity": 9, "hook": 7},
    "critique_text": "The email is clear but could be more specific.",
    "rewritten_email": {
        "subject": "A quick question",
        "body": "Hello Alex, I noticed your team is expanding. Regards, Harsh",
    },
}


def mock_model(monkeypatch, content):
    mocked = AsyncMock(return_value=model_response(content))
    monkeypatch.setattr(critic, "run_blocking", mocked)
    return mocked


def test_valid_response_is_returned(monkeypatch):
    mock_model(monkeypatch, json.dumps(VALID_RESULT))
    result = asyncio.run(
        critic.critique_and_rewrite(
            {"subject": "Original", "body": "Original body"},
            "Verified research",
        )
    )
    assert result == VALID_RESULT


@pytest.mark.parametrize(
    "draft",
    [None, "not a dictionary", {}, {"subject": 123, "body": "Body"},
     {"subject": "Subject", "body": None}],
)
def test_invalid_draft_is_rejected(draft):
    with pytest.raises(ValueError, match="draft must contain"):
        asyncio.run(critic.critique_and_rewrite(draft, "Research"))


def test_invalid_json_is_rejected(monkeypatch):
    mock_model(monkeypatch, "not JSON")
    with pytest.raises(RuntimeError, match="invalid JSON"):
        asyncio.run(
            critic.critique_and_rewrite(
                {"subject": "Hello", "body": "Body"}, "Research"
            )
        )


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"rewritten_email": "not an object"},
        {"rewritten_email": {"subject": 123, "body": "Body"}},
        {"rewritten_email": {"subject": "Subject", "body": None}},
        {
            "rewritten_email": {"subject": "Subject", "body": "Body"},
            "scores": {"personalization": 8, "clarity": 9},
        },
        {
            "rewritten_email": {"subject": "Subject", "body": "Body"},
            "scores": {"personalization": 0, "clarity": 9, "hook": 7},
        },
        {
            "rewritten_email": {"subject": "Subject", "body": "Body"},
            "scores": {"personalization": 11, "clarity": 9, "hook": 7},
        },
    ],
)
def test_malformed_critic_output_is_rejected(monkeypatch, payload):
    mock_model(monkeypatch, json.dumps(payload))
    with pytest.raises(RuntimeError):
        asyncio.run(
            critic.critique_and_rewrite(
                {"subject": "Hello", "body": "Body"}, "Research"
            )
        )


def test_boolean_score_is_rejected(monkeypatch):
    payload = {
        **VALID_RESULT,
        "scores": {"personalization": True, "clarity": 9, "hook": 7},
    }
    mock_model(monkeypatch, json.dumps(payload))
    with pytest.raises(RuntimeError, match="scores must be numbers"):
        asyncio.run(
            critic.critique_and_rewrite(
                {"subject": "Hello", "body": "Body"}, "Research"
            )
        )


@pytest.mark.parametrize(
    "email",
    [
        {"subject": "", "body": "A body"},
        {"subject": "A subject", "body": ""},
        {"subject": "   ", "body": "A body"},
        {"subject": "A subject", "body": "   "},
    ],
)
def test_empty_rewritten_email_fields_are_rejected(monkeypatch, email):
    payload = {**VALID_RESULT, "rewritten_email": email}
    mock_model(monkeypatch, json.dumps(payload))
    with pytest.raises(RuntimeError, match="must contain non-empty"):
        asyncio.run(
            critic.critique_and_rewrite(
                {"subject": "Hello", "body": "Body"}, "Research"
            )
        )
