import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import agents.researcher as researcher


def model_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content)
            )
        ]
    )


def mock_blocking_calls(monkeypatch, search_result, model_result):
    async def fake_run_blocking(func, *args, **kwargs):
        if func == researcher.tavily_client.search:
            if isinstance(search_result, Exception):
                raise search_result
            return search_result

        if func == researcher.ollama_client.chat.completions.create:
            if isinstance(model_result, Exception):
                raise model_result
            return model_result

        raise AssertionError(f"Unexpected blocking function: {func}")

    mocked = AsyncMock(side_effect=fake_run_blocking)
    monkeypatch.setattr(researcher, "run_blocking", mocked)
    return mocked


def test_research_returns_trimmed_model_output(monkeypatch):
    mock_blocking_calls(
        monkeypatch,
        {"results": [{"title": "Acme news", "content": "Acme launched a product."}]},
        model_response("  Acme builds software.  "),
    )

    result = asyncio.run(researcher.research_company("Acme"))

    assert result == "Acme builds software."


def test_blank_company_is_rejected_without_external_calls(monkeypatch):
    mocked = AsyncMock()
    monkeypatch.setattr(researcher, "run_blocking", mocked)

    with pytest.raises(ValueError, match="company_name must not be empty"):
        asyncio.run(researcher.research_company("   "))

    mocked.assert_not_awaited()


def test_empty_search_results_use_cautious_fallback(monkeypatch):
    mocked = mock_blocking_calls(
        monkeypatch,
        {"results": []},
        model_response("Available evidence is insufficient to verify recent news."),
    )

    result = asyncio.run(researcher.research_company("Acme"))

    assert "insufficient" in result.lower()
    model_call = mocked.await_args_list[1]
    prompt = model_call.kwargs["messages"][0]["content"]
    assert "No usable live search evidence was returned for Acme" in prompt
    assert "Do not invent company facts or recent news" in prompt
    assert "Do not invent facts, dates, source URLs, partnerships, or customer claims." in prompt
    assert "If evidence is missing or unclear, say so." in prompt


def test_tavily_failure_propagates(monkeypatch):
    mocked = mock_blocking_calls(
        monkeypatch,
        RuntimeError("search unavailable"),
        model_response("unused"),
    )

    with pytest.raises(RuntimeError, match="search unavailable"):
        asyncio.run(researcher.research_company("Acme"))

    assert mocked.await_count == 1


def test_empty_model_content_is_rejected(monkeypatch):
    mock_blocking_calls(
        monkeypatch,
        {"results": [{"title": "Acme", "content": "Company information"}]},
        model_response("   "),
    )

    with pytest.raises(RuntimeError, match="empty research response"):
        asyncio.run(researcher.research_company("Acme"))


def test_invalid_model_response_structure_is_rejected(monkeypatch):
    mock_blocking_calls(
        monkeypatch,
        {"results": [{"title": "Acme", "content": "Company information"}]},
        SimpleNamespace(choices=[]),
    )

    with pytest.raises(RuntimeError, match="invalid research response"):
        asyncio.run(researcher.research_company("Acme"))


def test_invalid_search_response_is_rejected(monkeypatch):
    mock_blocking_calls(
        monkeypatch,
        None,
        model_response("Some research"),
    )

    with pytest.raises(RuntimeError, match="invalid search response"):
        asyncio.run(researcher.research_company("Acme"))

def test_source_url_is_included_in_model_prompt(monkeypatch):
    mocked = mock_blocking_calls(
        monkeypatch,
        {
            "results": [
                {
                    "title": "Acme Product News",
                    "content": "Acme launched a new product.",
                    "url": "https://example.com/acme-news",
                }
            ]
        },
        model_response("Acme launched a product. Sources: https://example.com/acme-news"),
    )

    asyncio.run(researcher.research_company("Acme"))

    model_call = mocked.await_args_list[1]
    prompt = model_call.kwargs["messages"][0]["content"]

    assert "Title: Acme Product News" in prompt
    assert "URL: https://example.com/acme-news" in prompt


def test_missing_source_url_is_handled_safely(monkeypatch):
    mocked = mock_blocking_calls(
        monkeypatch,
        {
            "results": [
                {
                    "title": "Acme Product News",
                    "content": "Acme launched a new product.",
                }
            ]
        },
        model_response("The source URL was not provided."),
    )

    asyncio.run(researcher.research_company("Acme"))

    model_call = mocked.await_args_list[1]
    prompt = model_call.kwargs["messages"][0]["content"]

    assert "Title: Acme Product News" in prompt
    assert "URL: URL not provided" in prompt


def test_unusable_search_results_use_cautious_fallback(monkeypatch):
    mocked = mock_blocking_calls(
        monkeypatch,
        {
            "results": [
                {"title": "  ", "content": "  ", "url": "https://example.com/empty"}
            ]
        },
        model_response("There is insufficient evidence to verify company details."),
    )

    result = asyncio.run(researcher.research_company("Acme"))

    model_call = mocked.await_args_list[1]
    prompt = model_call.kwargs["messages"][0]["content"]

    assert "insufficient" in result.lower()
    assert "No usable live search evidence was returned for Acme" in prompt