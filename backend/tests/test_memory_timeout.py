"""A dead or hanging Hindsight must not make chat wait: one timeout, then a quick skip."""
import asyncio

import pytest

from app import memory


def test_hanging_hindsight_times_out_then_is_skipped(monkeypatch):
    monkeypatch.setattr(memory, "CALL_TIMEOUT", 0.05)
    memory.reset_cooldown()
    calls = []

    async def hang(**_):
        calls.append(1)
        await asyncio.sleep(10)

    async def run():
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        with pytest.raises(memory.MemoryUnavailable):
            await memory._call(hang)
        with pytest.raises(memory.MemoryUnavailable):
            await memory._call(hang)  # cool-down: fails instantly, no second attempt
        return loop.time() - t0

    elapsed = asyncio.run(run())
    assert len(calls) == 1
    assert elapsed < 1
    memory.reset_cooldown()


def test_refused_connection_is_skipped_after_first_failure():
    memory.reset_cooldown()
    calls = []

    async def refuse(**_):
        calls.append(1)
        raise ConnectionRefusedError()

    async def run():
        for _ in range(3):
            with pytest.raises(memory.MemoryUnavailable):
                await memory._call(refuse)

    asyncio.run(run())
    assert len(calls) == 1
    memory.reset_cooldown()
