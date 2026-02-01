"""서버 API 호출 모듈."""
from __future__ import annotations

import logging
from typing import List, Optional

import requests

from timer_overlay.timer_state import TimerState

logger = logging.getLogger(__name__)


class TimerAPI:
    """타이머 서버 API 클라이언트."""
    
    def __init__(self, base_url: str, timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
    
    def get_timers(self, channel_code: str) -> List[TimerState]:
        """타이머 목록 조회."""
        try:
            url = f"{self.base_url}/api/timers"
            response = self.session.get(
                url,
                params={"channelCode": channel_code},
                timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()
            
            timers_data = data.get("timers", [])
            if not isinstance(timers_data, list):
                return []
            
            timers = []
            for item in timers_data:
                try:
                    timer = TimerState.from_payload(item)
                    timers.append(timer)
                except Exception as e:
                    logger.warning("타이머 파싱 실패: %s", e)
            
            # displayOrder로 정렬
            timers.sort(key=lambda t: (t.display_order, t.id))
            return timers
            
        except requests.RequestException as e:
            logger.warning("타이머 조회 실패: %s", e)
            return []
    
    def start_timer(self, channel_code: str, timer_id: str) -> Optional[TimerState]:
        """타이머 시작."""
        return self._post_action(channel_code, timer_id, "start")
    
    def pause_timer(self, channel_code: str, timer_id: str) -> Optional[TimerState]:
        """타이머 일시정지."""
        return self._post_action(channel_code, timer_id, "pause")
    
    def reset_timer(self, channel_code: str, timer_id: str) -> Optional[TimerState]:
        """타이머 리셋."""
        return self._post_action(channel_code, timer_id, "reset")
    
    def _post_action(
        self, channel_code: str, timer_id: str, action: str
    ) -> Optional[TimerState]:
        """타이머 액션 요청."""
        try:
            url = f"{self.base_url}/api/timers/{timer_id}/{action}"
            response = self.session.post(
                url,
                params={"channelCode": channel_code},
                json={},
                timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()
            return TimerState.from_payload(data)
        except requests.RequestException as e:
            logger.warning("타이머 %s 실패: %s", action, e)
            return None
    
    def check_health(self) -> bool:
        """서버 연결 확인."""
        try:
            url = f"{self.base_url}/api/health"
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            return True
        except requests.RequestException:
            return False
    
    def close(self):
        """세션 종료."""
        self.session.close()
