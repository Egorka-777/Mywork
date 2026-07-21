"""Atomic JSON store for Task Radar under workbench data/."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from task_radar_types import default_settings

log = logging.getLogger(__name__)

_DEFAULT_DATA_DIR = (
    Path(__file__).resolve().parent.parent / "artifacts" / "workbench" / "data" / "task-radar"
)


def data_dir() -> Path:
    override = os.environ.get("TASK_RADAR_DATA_DIR", "").strip()
    return Path(override) if override else _DEFAULT_DATA_DIR


def settings_path() -> Path:
    return data_dir() / "settings.json"


def items_path() -> Path:
    return data_dir() / "items.json"


def runs_path() -> Path:
    return data_dir() / "runs.jsonl"


def replies_path() -> Path:
    return data_dir() / "replies.jsonl"


def ensure_dir() -> None:
    data_dir().mkdir(parents=True, exist_ok=True)


def _backup_malformed(path: Path, raw: str) -> None:
    backup = path.with_name(f"{path.name}.malformed.{int(time.time() * 1000)}.bak")
    backup.write_text(raw, encoding="utf-8")
    try:
        path.unlink(missing_ok=True)
    except TypeError:
        if path.exists():
            path.unlink()
    log.warning("Task Radar malformed JSON moved to %s", backup)


def read_json(path: Path, fallback: Any) -> Any:
    ensure_dir()
    if not path.exists():
        return fallback
    raw = path.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        _backup_malformed(path, raw)
        return fallback


def write_json_atomic(path: Path, value: Any) -> None:
    ensure_dir()
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    ensure_dir()
    line = json.dumps(record, ensure_ascii=False)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def load_settings() -> dict[str, Any]:
    base = default_settings()
    stored = read_json(settings_path(), {})
    if not isinstance(stored, dict):
        return base
    merged = {**base, **stored}
    return merged


def save_settings(settings: dict[str, Any]) -> dict[str, Any]:
    base = default_settings()
    merged = {**base, **settings}
    write_json_atomic(settings_path(), merged)
    return merged


def load_items() -> list[dict[str, Any]]:
    raw = read_json(items_path(), [])
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def save_items(items: list[dict[str, Any]]) -> None:
    write_json_atomic(items_path(), items)


def find_item(item_id: str) -> dict[str, Any] | None:
    for item in load_items():
        if item.get("id") == item_id:
            return item
    return None


def update_item(item_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    items = load_items()
    updated: dict[str, Any] | None = None
    for idx, item in enumerate(items):
        if item.get("id") == item_id:
            items[idx] = {**item, **patch}
            updated = items[idx]
            break
    if updated is None:
        return None
    save_items(items)
    return updated


def load_replies() -> list[dict[str, Any]]:
    path = replies_path()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out
