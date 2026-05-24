from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import websockets
import websockets.exceptions

from session import SessionManager
from storage import StorageManager
from validator import (
    validate_ecg,
    validate_rr,
    validate_session_end,
    validate_session_start,
)

# ── Configuration ─────────────────────────────────────────────────────────────

HOST = "0.0.0.0"
PORT = 8765
DATA_DIR = "data"
LOG_LEVEL = "INFO"

# ── Logging ───────────────────────────────────────────────────────────────────


class _TimestampFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        return f"[{ts}] {record.levelname} — {record.getMessage()}"


def _setup_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_TimestampFormatter())
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.handlers = [handler]
    # Suppress noisy websockets internal logs below WARNING
    logging.getLogger("websockets").setLevel(logging.WARNING)


logger = logging.getLogger(__name__)

# ── Periodic summary ──────────────────────────────────────────────────────────


async def _periodic_summary(session: SessionManager, interval: int = 60) -> None:
    try:
        while session.is_active:
            await asyncio.sleep(interval)
            if not session.is_active:
                break
            s = session.get_summary()
            ecg_part = (
                f"ECG frames:{s['ecg_frame_count']}"
                if s["ecg_frame_count"] > 0
                else "ECG:n/a"
            )
            logger.info(
                f"[60s update] RR:{s['rr_count']} | {ecg_part} | dropped:{s['dropped_packets']}"
            )
    except asyncio.CancelledError:
        pass


# ── Message router ────────────────────────────────────────────────────────────


async def _handle_message(
    raw: str,
    session: SessionManager,
    storage: StorageManager,
) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error(f"JSON parse error: {exc}")
        return

    if not isinstance(msg, dict):
        logger.warning("Message is not a JSON object — skipping")
        return

    msg_type = msg.get("type")

    if msg_type == "session_start":
        if not validate_session_start(msg):
            logger.warning("Dropping invalid session_start message")
            return
        session.start(msg)
        storage.open_session(msg["session_id"], msg.get("streams", []))

    elif msg_type == "rr":
        if not validate_rr(msg):
            logger.warning("Dropping invalid rr message")
            return
        session.add_rr(msg)
        storage.write_rr(msg)
        rr_vals = [round(v, 1) for v in msg.get("rr_intervals_ms", [])]
        logger.info(
            f"RR seq:{msg['seq']} | HR:{msg['hr_bpm']} bpm | RR:{rr_vals}ms"
        )

    elif msg_type == "ecg":
        if not validate_ecg(msg):
            logger.warning("Dropping invalid ecg message")
            return
        session.add_ecg(msg)
        storage.write_ecg(msg)
        logger.info(f"ECG seq:{msg['seq']} | {len(msg['samples_uv'])} samples")

    elif msg_type == "session_end":
        if not validate_session_end(msg):
            logger.warning("Dropping invalid session_end message")
            return
        session.end(msg)
        storage.flush()

    else:
        logger.warning(f"Unknown message type: {msg_type!r}")


# ── Client handler ────────────────────────────────────────────────────────────


async def _client_handler(websocket) -> None:
    logger.info("Client connected")
    session = SessionManager()
    storage = StorageManager(DATA_DIR)
    summary_task: Optional[asyncio.Task] = None  # type: ignore[type-arg]

    try:
        async for raw in websocket:
            was_active = session.is_active
            await _handle_message(raw, session, storage)

            # Start periodic summary when a session becomes active
            if session.is_active and not was_active:
                if summary_task is not None:
                    summary_task.cancel()
                summary_task = asyncio.create_task(_periodic_summary(session))

            # Clean up the task when a session ends cleanly
            elif not session.is_active and was_active:
                if summary_task is not None:
                    summary_task.cancel()
                    summary_task = None

    except websockets.exceptions.ConnectionClosedError:
        logger.info("Client disconnected unexpectedly")
    except websockets.exceptions.ConnectionClosedOK:
        logger.info("Client disconnected")
    except Exception as exc:
        logger.error(f"Unexpected error in client handler: {exc}")
    finally:
        if summary_task is not None:
            summary_task.cancel()
        if session.is_active:
            logger.info("Closing open session due to client disconnect")
            session.end(None)
            storage.flush()
        logger.info("Connection closed")


# ── Entry point ───────────────────────────────────────────────────────────────


async def main() -> None:
    _setup_logging(LOG_LEVEL)

    data_path = Path(DATA_DIR).resolve()
    data_path.mkdir(parents=True, exist_ok=True)

    logger.info(f"Server started on ws://{HOST}:{PORT}")
    logger.info(f"Saving data to: {data_path}")

    async with websockets.serve(_client_handler, HOST, PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")
