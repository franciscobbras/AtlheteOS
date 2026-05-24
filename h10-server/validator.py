from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _require(msg: dict, *fields: str) -> bool:
    for field in fields:
        if field not in msg:
            logger.warning(f"Missing required field: {field!r}")
            return False
    return True


def validate_session_start(msg: dict) -> bool:
    if not _require(msg, "session_id", "timestamp_ms", "streams"):
        return False
    if not isinstance(msg["session_id"], str) or not msg["session_id"]:
        logger.warning("session_id must be a non-empty string")
        return False
    if not isinstance(msg["streams"], list):
        logger.warning("streams must be a list")
        return False
    return True


def validate_rr(msg: dict) -> bool:
    if not _require(msg, "session_id", "seq", "timestamp_ms", "hr_bpm", "rr_intervals_ms"):
        return False
    hr = msg["hr_bpm"]
    if not isinstance(hr, (int, float)) or not (20 <= hr <= 250):
        logger.warning(f"hr_bpm out of valid range [20, 250]: {hr}")
        return False
    rr_list = msg["rr_intervals_ms"]
    if not isinstance(rr_list, list):
        logger.warning("rr_intervals_ms must be a list")
        return False
    for val in rr_list:
        if not isinstance(val, (int, float)) or not (200 <= val <= 2500):
            logger.warning(f"RR interval out of valid range [200, 2500] ms: {val}")
            return False
    return True


def validate_ecg(msg: dict) -> bool:
    if not _require(msg, "session_id", "seq", "timestamp_ns", "samples_uv"):
        return False
    samples = msg["samples_uv"]
    if not isinstance(samples, list) or len(samples) == 0:
        logger.warning("samples_uv must be a non-empty list")
        return False
    if len(samples) > 200:
        logger.warning(f"samples_uv is unusually large ({len(samples)} samples) — accepting anyway")
    return True


def validate_session_end(msg: dict) -> bool:
    if not _require(msg, "session_id", "timestamp_ms"):
        return False
    return True
