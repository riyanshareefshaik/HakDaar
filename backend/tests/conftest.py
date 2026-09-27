import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    from app import config, db
    monkeypatch.setattr(config.settings, "database_path", tmp_path / "test.db")
    db.init_db()
    yield
