from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import IO, Optional

logger = logging.getLogger(__name__)

FLUSH_INTERVAL = 100

RR_HEADERS = ["session_id", "seq", "timestamp_ms", "hr_bpm", "rr_interval_ms", "rr_index"]
ECG_HEADERS = ["session_id", "seq", "frame_timestamp_ns", "sample_index", "ecg_uv"]


class StorageManager:
    def __init__(self, data_dir: str) -> None:
        self._data_dir = Path(data_dir)
        self._data_dir.mkdir(parents=True, exist_ok=True)

        self._session_id: str = ""
        self._rr_file: Optional[IO[str]] = None
        self._rr_writer: Optional[csv.writer] = None  # type: ignore[type-arg]
        self._ecg_file: Optional[IO[str]] = None
        self._ecg_writer: Optional[csv.writer] = None  # type: ignore[type-arg]
        self._rr_row_count: int = 0
        self._ecg_row_count: int = 0
        self._rr_path: Optional[Path] = None
        self._ecg_path: Optional[Path] = None

    def open_session(self, session_id: str, streams: list[str]) -> None:
        self._session_id = session_id
        self._rr_row_count = 0
        self._ecg_row_count = 0

        # Default: always open RR. Open ECG only when explicitly listed.
        open_rr = "rr" in streams or not streams
        open_ecg = "ecg" in streams

        try:
            if open_rr:
                self._rr_path = self._data_dir / f"{session_id}_rr.csv"
                self._rr_file = open(self._rr_path, "w", newline="", encoding="utf-8")
                self._rr_writer = csv.writer(self._rr_file)
                self._rr_writer.writerow(RR_HEADERS)
                self._rr_file.flush()

            if open_ecg:
                self._ecg_path = self._data_dir / f"{session_id}_ecg.csv"
                self._ecg_file = open(self._ecg_path, "w", newline="", encoding="utf-8")
                self._ecg_writer = csv.writer(self._ecg_file)
                self._ecg_writer.writerow(ECG_HEADERS)
                self._ecg_file.flush()

        except OSError as exc:
            logger.error(f"Failed to open session files for {session_id[:8]}...: {exc}")

    def write_rr(self, message: dict) -> None:
        if self._rr_writer is None:
            return
        try:
            session_id: str = message["session_id"]
            seq: int = message["seq"]
            ts: int = message.get("timestamp_ms", 0)
            hr: float = message.get("hr_bpm", 0)
            rr_list: list = message.get("rr_intervals_ms", [])

            for idx, rr_val in enumerate(rr_list):
                self._rr_writer.writerow([session_id, seq, ts, hr, rr_val, idx])
                self._rr_row_count += 1

            if self._rr_row_count % FLUSH_INTERVAL == 0 and self._rr_file:
                self._rr_file.flush()

        except (OSError, KeyError) as exc:
            logger.error(f"Failed to write RR row: {exc}")

    def write_ecg(self, message: dict) -> None:
        if self._ecg_writer is None:
            return
        try:
            session_id: str = message["session_id"]
            seq: int = message["seq"]
            ts_ns: str = str(message.get("timestamp_ns", "0"))
            samples: list = message.get("samples_uv", [])

            for idx, sample in enumerate(samples):
                self._ecg_writer.writerow([session_id, seq, ts_ns, idx, sample])
                self._ecg_row_count += 1

            if self._ecg_row_count % FLUSH_INTERVAL == 0 and self._ecg_file:
                self._ecg_file.flush()

        except (OSError, KeyError) as exc:
            logger.error(f"Failed to write ECG row: {exc}")

    def flush(self) -> None:
        written: list[str] = []

        try:
            if self._rr_file:
                self._rr_file.flush()
                self._rr_file.close()
                self._rr_file = None
                self._rr_writer = None
                if self._rr_path:
                    written.append(f"    {self._rr_path} ({self._rr_row_count} rows)")

            if self._ecg_file:
                self._ecg_file.flush()
                self._ecg_file.close()
                self._ecg_file = None
                self._ecg_writer = None
                if self._ecg_path:
                    written.append(f"    {self._ecg_path} ({self._ecg_row_count} rows)")

        except OSError as exc:
            logger.error(f"Error closing session files: {exc}")

        if written:
            logger.info("Files written:\n" + "\n".join(written))
