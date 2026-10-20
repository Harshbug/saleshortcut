import asyncio
import threading
import time
import unittest

from agents.runtime import run_blocking


class RunBlockingTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_sync_function_result(self):
        result = await run_blocking(lambda left, right: left + right, 20, 22)
        self.assertEqual(result, 42)

    async def test_sync_function_does_not_block_event_loop(self):
        started = threading.Event()

        def slow_call():
            started.set()
            time.sleep(0.15)
            return "finished"

        task = asyncio.create_task(run_blocking(slow_call))
        await asyncio.sleep(0.01)
        self.assertTrue(started.is_set())
        # The event loop can run this coroutine while the blocking function sleeps.
        self.assertFalse(task.done())
        self.assertEqual(await task, "finished")

    async def test_propagates_exceptions(self):
        def fail():
            raise ValueError("expected test failure")

        with self.assertRaisesRegex(ValueError, "expected test failure"):
            await run_blocking(fail)


if __name__ == "__main__":
    unittest.main()
