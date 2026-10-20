
import os
from unittest.mock import AsyncMock

# Set these before importing main, because agents initialize clients at import time.
os.environ.setdefault("TAVILY_API_KEY", "test-key")
os.environ.setdefault("OLLAMA_API_KEY", "ollama")

from fastapi.testclient import TestClient
import main


client = TestClient(main.app)


def test_root_endpoint():
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"message": "SDR Agent API ready"}


def test_generate_rejects_blank_company():
    response = client.post("/generate", json={"company": "   "})

    assert response.status_code == 400
    assert response.json()["detail"] == "company is required"


def test_generate_runs_single_company_pipeline(monkeypatch):
    expected = {
        "research": "Verified company research",
        "related_businesses": None,
        "draft": {"subject": "Hello", "body": "Initial email"},
        "final": {
            "scores": {"personalization": 8, "clarity": 9, "hook": 7},
            "rewritten_email": {"subject": "Hello", "body": "Final email"},
        },
    }

    pipeline = AsyncMock(return_value=expected)
    monkeypatch.setattr(main, "run_pipeline", pipeline)

    response = client.post(
        "/generate",
        json={"company": "  Acme Inc  ", "target_count": 1},
    )

    assert response.status_code == 200
    assert response.json() == expected
    pipeline.assert_awaited_once_with(
        "Acme Inc",
        recipient_name=None,
        sender_name=None,
        context=None,
        suggest_related=False,
    )


def test_generate_runs_batch_for_resolved_targets(monkeypatch):
    targets = ["Acme Inc", "Example Corp"]

    async def fake_resolve(company, context, count):
        assert company == "Acme Inc"
        assert context is None
        assert count == 2
        return targets

    async def fake_pipeline(company, **kwargs):
        return {
            "research": f"Research for {company}",
            "related_businesses": None,
            "draft": {"subject": "Hello", "body": "Draft"},
            "final": {"rewritten_email": {"subject": "Hello", "body": "Final"}},
        }

    resolver = AsyncMock(side_effect=fake_resolve)
    pipeline = AsyncMock(side_effect=fake_pipeline)

    monkeypatch.setattr(main, "resolve_target_companies", resolver)
    monkeypatch.setattr(main, "run_pipeline", pipeline)

    response = client.post(
        "/generate",
        json={"company": "Acme Inc", "target_count": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["batch"] is True
    assert payload["targets"] == targets
    assert [item["company"] for item in payload["results"]] == targets
    assert resolver.await_count == 1
    assert pipeline.await_count == 2

def test_generate_rejects_target_count_below_minimum():
    response = client.post(
        "/generate",
        json={"company": "Acme Inc", "target_count": 0},
    )

    assert response.status_code == 422


def test_generate_rejects_target_count_above_maximum():
    response = client.post(
        "/generate",
        json={"company": "Acme Inc", "target_count": 9},
    )

    assert response.status_code == 422


def test_generate_rejects_non_integer_target_count():
    response = client.post(
        "/generate",
        json={"company": "Acme Inc", "target_count": "many"},
    )

    assert response.status_code == 422


def test_generate_rejects_missing_company():
    response = client.post(
        "/generate",
        json={"target_count": 1},
    )

    assert response.status_code == 422


def test_generate_stream_does_not_expose_internal_exception(monkeypatch):
    async def fail_to_resolve(*args, **kwargs):
        raise RuntimeError("internal-secret-detail")

    monkeypatch.setattr(
        main,
        "resolve_target_companies",
        fail_to_resolve,
    )

    response = client.get(
        "/generate-stream",
        params={"company": "Acme Inc", "target_count": 2},
    )

    assert response.status_code == 200
    assert "internal-secret-detail" not in response.text
    assert '"type": "error"' in response.text
    assert '"type": "done"' in response.text
