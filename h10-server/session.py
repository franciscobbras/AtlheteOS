from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


class SessionManager:
    def __init__(self) -> None:
        self.session_id: str = ""
        self.started_at: Optional[datetime] = None
        self.streams: list[str] = []
        self.rr_count: int = 0
        self.ecg_frame_count: int = 0
        self.ecg_sample_count: int = 0
        self.last_seq: int = -1
        self.dropped_packets: int = 0
        self.is_active: bool = False

    def start(self, message: dict) -> None:
        self.session_id = message["session_id"]
        self.started_at = datetime.now()
        self.streams = message.get("streams", [])
        self.rr_count = 0
        self.ecg_frame_count = 0
        self.ecg_sample_count = 0
        self.last_seq = -1
        self.dropped_packets = 0
        self.is_active = True

        streams_str = ", ".join(self.streams) if self.streams else "unknown"
        logger.info(
            f"Session started: {self.session_id[:8]}... (streams: {streams_str})"
        )

    def add_rr(self, message: dict) -> None:
        seq: int = message["seq"]
        if self.last_seq >= 0 and seq != self.last_seq + 1:
            gap = seq - (self.last_seq + 1)
            self.dropped_packets += gap
            logger.warning(
                f"Dropped packets detected: seq jumped {self.last_seq}→{seq}"
            )
        self.last_seq = seq
        self.rr_count += 1

    def add_ecg(self, message: dict) -> None:
        self.ecg_frame_count += 1
        self.ecg_sample_count += len(message.get("samples_uv", []))

    def end(self, message: Optional[dict]) -> dict:
        self.is_active = False
        now = datetime.now()
        started = self.started_at or now
        duration_s = (now - started).total_seconds()

        total_packets = self.rr_count + self.ecg_frame_count
        drop_ratio = self.dropped_packets / max(total_packets, 1)
        if drop_ratio < 0.01:
            quality = "Good"
        elif drop_ratio < 0.05:
            quality = "Fair"
        else:
            quality = "Poor"

        mins = int(duration_s // 60)
        secs = int(duration_s % 60)
        dur_str = f"{mins}m{secs:02d}s"

        ecg_frames_str = str(self.ecg_frame_count) if self.ecg_frame_count > 0 else "not available"
        ecg_samples_str = str(self.ecg_sample_count) if self.ecg_sample_count > 0 else "not available"

        logger.info(
            f"Session ended: duration={dur_str} | "
            f"RR:{self.rr_count} | ECG:{ecg_frames_str} frames | "
            f"ECG samples:{ecg_samples_str} | "
            f"dropped:{self.dropped_packets} | quality:{quality}"
        )

        return {
            "session_id": self.session_id,
            "duration_seconds": duration_s,
            "rr_count": self.rr_count,
            "ecg_frame_count": self.ecg_frame_count,
            "ecg_sample_count": self.ecg_sample_count,
            "dropped_packets": self.dropped_packets,
            "quality": quality,
        }

    def get_summary(self) -> dict:
        return {
            "session_id": self.session_id,
            "rr_count": self.rr_count,
            "ecg_frame_count": self.ecg_frame_count,
            "ecg_sample_count": self.ecg_sample_count,
            "dropped_packets": self.dropped_packets,
            "is_active": self.is_active,
        }
