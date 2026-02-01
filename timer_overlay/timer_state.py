"""타이머 상태 모델."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class TimerState:
    """서버에서 받은 타이머 상태."""
    
    id: str
    name: str
    duration_ms: int
    remaining_ms: int
    is_running: bool
    repeat_enabled: bool
    display_order: int
    end_time_epoch_ms: Optional[int] = None  # 서버 time 기준 (epoch ms)
    
    @classmethod
    def from_payload(cls, data: Dict[str, Any]) -> TimerState:
        """서버 응답에서 TimerState 생성."""
        timer_id = str(data.get("id", ""))
        name = str(data.get("name", ""))
        duration_ms = int(data.get("duration", 0))
        remaining_ms = int(data.get("remaining", 0))
        is_running = bool(data.get("isRunning", False))
        repeat_enabled = bool(data.get("repeatEnabled", False))
        display_order = data.get("displayOrder", 0)
        if not isinstance(display_order, (int, float)):
            display_order = 0
        
        # endTime: 서버에서 받은 epoch milliseconds
        end_time = data.get("endTime")
        end_time_epoch_ms = int(end_time) if end_time is not None else None
        
        return cls(
            id=timer_id,
            name=name,
            duration_ms=duration_ms,
            remaining_ms=remaining_ms,
            is_running=is_running,
            repeat_enabled=repeat_enabled,
            display_order=int(display_order),
            end_time_epoch_ms=end_time_epoch_ms,
        )
    
    def get_remaining_ms(self) -> int:
        """현재 남은 시간 계산 (ms)."""
        if not self.is_running:
            return self.remaining_ms
        
        if self.end_time_epoch_ms is None:
            return self.remaining_ms
        
        now_epoch_ms = int(time.time() * 1000)
        remaining = self.end_time_epoch_ms - now_epoch_ms
        return max(0, remaining)
    
    def get_remaining_str(self) -> str:
        """MM:SS 형식 반환."""
        ms = self.get_remaining_ms()
        total_seconds = ms // 1000
        minutes = total_seconds // 60
        seconds = total_seconds % 60
        return f"{minutes:02d}:{seconds:02d}"
    
    def get_progress(self) -> float:
        """진행률 (0.0 ~ 1.0)."""
        if self.duration_ms <= 0:
            return 0.0
        remaining = self.get_remaining_ms()
        return max(0.0, min(1.0, remaining / self.duration_ms))
    
    def is_expired(self) -> bool:
        """타이머가 만료되었는지 확인."""
        return self.is_running and self.get_remaining_ms() == 0
