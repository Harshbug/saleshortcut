"""Shared runtime helpers for blocking third-party SDK calls.

The current Tavily SDK and configured OpenAI-compatible client are synchronous.
Run them off the ASGI event loop and cap simultaneous SDK calls. SDK-level
network timeouts are still required because cancelling a worker thread cannot
forcibly stop its underlying network request.
"""
from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")
_MAX_CONCURRENT_BLOCKING_CALLS = 8
_BLOCKING_CALLS = threading.BoundedSemaphore(_MAX_CONCURRENT_BLOCKING_CALLS)


def _call_with_slot(func: Callable[..., T], *args: object, **kwargs: object) -> T:
    with _BLOCKING_CALLS:
        return func(*args, **kwargs)


async def run_blocking(func: Callable[..., T], /, *args: object, **kwargs: object) -> T:
    """Run a synchronous SDK operation without blocking the asyncio event loop."""
    return await asyncio.to_thread(_call_with_slot, func, *args, **kwargs)
