"""백그라운드 타이머 상태 폴링 서비스."""
from __future__ import annotations

import logging
from typing import Callable, List, Optional

from PyQt5.QtCore import QObject, QTimer, pyqtSignal

from timer_overlay.timer_api import TimerAPI
from timer_overlay.timer_state import TimerState

logger = logging.getLogger(__name__)


class TimerPoller(QObject):
    """서버에서 타이머 상태를 주기적으로 폴링."""
    
    # 시그널: 타이머 목록 업데이트됨
    timers_updated = pyqtSignal(list)  # List[TimerState]
    # 시그널: 연결 상태 변경
    connection_changed = pyqtSignal(bool, str)  # connected, message
    
    def __init__(
        self,
        api: TimerAPI,
        channel_code: str,
        interval_ms: int = 500,
        parent: Optional[QObject] = None
    ):
        super().__init__(parent)
        self.api = api
        self.channel_code = channel_code
        self.interval_ms = interval_ms
        
        # 마지막으로 성공한 타이머 목록 (에러 시 유지용)
        self._last_timers: List[TimerState] = []
        self._connected = False
        
        # 폴링 타이머
        self._poll_timer = QTimer(self)
        self._poll_timer.timeout.connect(self._poll)
    
    def start(self):
        """폴링 시작."""
        if not self._poll_timer.isActive():
            self._poll()  # 즉시 한 번 폴링
            self._poll_timer.start(self.interval_ms)
            logger.info("폴링 시작: %dms 간격", self.interval_ms)
    
    def stop(self):
        """폴링 중지."""
        self._poll_timer.stop()
        logger.info("폴링 중지")
    
    def set_channel_code(self, channel_code: str):
        """채널 코드 변경."""
        self.channel_code = channel_code
        self._last_timers = []
        if self._poll_timer.isActive():
            self._poll()  # 즉시 폴링
    
    def get_last_timers(self) -> List[TimerState]:
        """마지막으로 받은 타이머 목록."""
        return self._last_timers.copy()
    
    def _poll(self):
        """서버에서 타이머 상태 조회."""
        if not self.channel_code:
            self._set_connection_state(False, "채널 코드가 필요합니다.")
            return
        
        timers = self.api.get_timers(self.channel_code)
        
        if timers:
            self._last_timers = timers
            self._set_connection_state(True, "연결됨")
            self.timers_updated.emit(timers)
        elif len(self._last_timers) > 0:
            # 에러지만 기존 타이머가 있으면 유지
            self._set_connection_state(False, "서버 응답 없음 (기존 상태 유지)")
            # 기존 타이머 emit (UI 갱신용)
            self.timers_updated.emit(self._last_timers)
        else:
            # 타이머도 없고 에러
            self._set_connection_state(False, "타이머를 불러올 수 없습니다.")
    
    def _set_connection_state(self, connected: bool, message: str):
        """연결 상태 변경 시 시그널 발생."""
        if connected != self._connected:
            self._connected = connected
            self.connection_changed.emit(connected, message)
            logger.info("연결 상태: %s - %s", connected, message)
