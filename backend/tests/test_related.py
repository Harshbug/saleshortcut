
import asyncio
from unittest.mock import AsyncMock

import pytest

from agents import related


def test_blank_seed_returns_empty_list():
    result = asyncio.run(
        related.resolve_target_companies("   ", context=None, count=3)
    )

    assert result == []


def test_count_one_returns_seed_without_external_calls(monkeypatch):
    search = AsyncMock()
    monkeypatch.setattr(related, "run_blocking", search)

    result = asyncio.run(
        related.resolve_target_companies("  Acme Inc  ", context=None, count=1)
    )

    assert result == ["Acme Inc"]
    search.assert_not_awaited()


def test_find_related_businesses_rejects_invalid_search_response(monkeypatch):
    monkeypatch.setattr(
        related,
        "run_blocking",
        AsyncMock(return_value=[]),
    )

    with pytest.raises(RuntimeError, match="invalid search response"):
        asyncio.run(related.find_related_businesses("Acme Inc"))


def test_find_related_businesses_rejects_invalid_result_item(monkeypatch):
    monkeypatch.setattr(
        related,
        "run_blocking",
        AsyncMock(return_value={"results": ["not a dictionary"]}),
    )

    with pytest.raises(RuntimeError, match="invalid search result"):
        asyncio.run(related.find_related_businesses("Acme Inc"))


def test_find_related_businesses_skips_empty_results(monkeypatch):
    monkeypatch.setattr(
        related,
        "run_blocking",
        AsyncMock(return_value={
            "results": [
                {"title": "", "content": "", "url": ""},
                {
                    "title": "Example competitor",
                    "content": "A competing product.",
                    "url": "https://example.com",
                },
            ]
        }),
    )

    result = asyncio.run(related.find_related_businesses("Acme Inc"))

    assert "Example competitor" in result
    assert "https://example.com" in result
    assert "A competing product." in result
    assert result.count("Example competitor") == 1


def test_resolve_target_companies_rejects_invalid_search_response(monkeypatch):
    monkeypatch.setattr(
        related,
        "run_blocking",
        AsyncMock(return_value=[]),
    )

    with pytest.raises(RuntimeError, match="invalid search response"):
        asyncio.run(
            related.resolve_target_companies(
                "Acme Inc", context=None, count=2
            )
        )


def test_resolve_target_companies_rejects_invalid_result_item(monkeypatch):
    monkeypatch.setattr(
        related,
        "run_blocking",
        AsyncMock(return_value={"results": ["not a dictionary"]}),
    )

    with pytest.raises(RuntimeError, match="invalid search result"):
        asyncio.run(
            related.resolve_target_companies(
                "Acme Inc", context=None, count=2
            )
        )


def test_resolve_target_companies_keeps_seed_first(monkeypatch):
    async def fake_run_blocking(func, *args, **kwargs):
        if func == related.tavily_client.search:
            return {
                "results": [
                    {
                        "title": "Example Competitor",
                        "content": "An alternative to Acme.",
                        "url": "https://example.com",
                    }
                ]
            }
        return type(
            "Response",
            (),
            {
                "choices": [
                    type(
                        "Choice",
                        (),
                        {
                            "message": type(
                                "Message",
                                (),
                                {"content": '["Example Competitor"]'},
                            )()
                        },
                    )()
                ]
            },
        )()

    monkeypatch.setattr(related, "run_blocking", fake_run_blocking)

    result = asyncio.run(
        related.resolve_target_companies(
            "Acme Inc", context=None, count=2
        )
    )

    assert result[0] == "Acme Inc"
    assert len(result) == 2
    assert result[1] == "Example Competitor"


def test_resolve_target_companies_does_not_invent_peer_names(monkeypatch):
    async def fake_run_blocking(func, *args, **kwargs):
        if func == related.tavily_client.search:
            return {
                "results": [
                    {
                        "title": "Acme Inc company overview",
                        "content": "An overview of Acme Inc.",
                        "url": "https://example.com/acme",
                    }
                ]
            }

        # Simulate an LLM that returns no usable company names.
        return type(
            "Response",
            (),
            {
                "choices": [
                    type(
                        "Choice",
                        (),
                        {
                            "message": type(
                                "Message",
                                (),
                                {"content": "[]"},
                            )()
                        },
                    )()
                ]
            },
        )()

    monkeypatch.setattr(related, "run_blocking", fake_run_blocking)

    # No related businesses can be found by the fallback either.
    monkeypatch.setattr(
        related,
        "find_related_businesses",
        AsyncMock(return_value="No related-business search results found for Acme Inc."),
    )

    result = asyncio.run(
        related.resolve_target_companies(
            "Acme Inc", context=None, count=3
        )
    )

    assert result == ["Acme Inc"]
    assert not any(name.startswith("Peer ") for name in result)
