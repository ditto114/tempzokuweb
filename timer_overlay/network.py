"""서버와의 통신을 담당하는 모듈."""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests
from PyQt5.QtCore import QObject, pyqtSignal

logger = logging.getLogger(__name__)


@dataclass
class ServerSettings:
    """서버 접속 정보를 담는 데이터 클래스."""

    host: str
    port: int

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"


@dataclass
class RemoteTimerState:
    """서버에서 전달된 단일 타이머 상태."""

    id: str
    name: str
    duration_ms: int
    remaining_ms: int
    is_running: bool
    repeat_enabled: bool
    display_order: int

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "RemoteTimerState":
        timer_id = str(payload.get("id"))
        name = str(payload.get("name", "타이머"))
        duration = int(payload.get("duration", payload.get("durationMs", 0)) or 0)
        remaining = int(payload.get("remaining", payload.get("remainingMs", 0)) or 0)
        is_running = bool(payload.get("isRunning", False))
        repeat_enabled = bool(payload.get("repeatEnabled", False))
        raw_order = payload.get("displayOrder")
        try:
            display_order = int(raw_order)
        except (TypeError, ValueError):
            display_order = 0
        return cls(
            id=timer_id,
            name=name,
            duration_ms=max(0, duration),
            remaining_ms=max(0, remaining),
            is_running=is_running,
            repeat_enabled=repeat_enabled,
            display_order=display_order,
        )

    @property
    def remaining_seconds(self) -> int:
        return max(0, int(self.remaining_ms // 1000))

    @property
    def formatted_remaining(self) -> str:
        total = self.remaining_seconds
        hours, remainder = divmod(total, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours:
            return f"{hours:02}:{minutes:02}:{seconds:02}"
        return f"{minutes:02}:{seconds:02}"

    @property
    def sort_index(self) -> tuple[int, int, str]:
        numeric_id = 0
        try:
            numeric_id = int(self.id)
        except (TypeError, ValueError):
            numeric_id = 0
        return (self.display_order, numeric_id, self.name)


class TimerService(QObject):
    """서버와의 실시간 동기화를 담당한다."""

    timers_updated = pyqtSignal(dict)
    connection_state_changed = pyqtSignal(bool, str)

    def __init__(self, settings: ServerSettings) -> None:
        super().__init__()
        self._settings = settings
        self._stream_session: Optional[requests.Session] = None
        self._actions_session = requests.Session()
        self._running = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        """스트림 수신을 시작한다."""

        if self._running.is_set():
            return
        self._running.set()
        if not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def stop(self) -> None:
        """스트림 수신을 중단한다."""

        if not self._running.is_set():
            return

        self._running.clear()
        session = self._stream_session
        if session is not None:
            session.close()
        if self._thread.is_alive():
            self._thread.join(timeout=2)
        self._stream_session = None

    def update_settings(self, settings: ServerSettings) -> None:
        """서버 접속 설정을 변경한다."""

        if settings == self._settings:
            return

        was_running = self._running.is_set()
        if was_running:
            self.stop()
        self._settings = settings
        if was_running:
            self.start()

    @property
    def is_running(self) -> bool:
        return self._running.is_set()

    def start_timer(self, timer_id: str) -> bool:
        return self._post_action(f"/api/timers/{timer_id}/start")

    def pause_timer(self, timer_id: str) -> bool:
        return self._post_action(f"/api/timers/{timer_id}/pause")

    def reset_timer(self, timer_id: str) -> bool:
        return self._post_action(f"/api/timers/{timer_id}/reset")

    def _post_action(self, path: str, payload: Optional[Dict[str, Any]] = None) -> bool:
        url = f"{self._settings.base_url}{path}"
        try:
            response = self._actions_session.post(url, json=payload or {}, timeout=5)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.warning("서버 요청 실패 (%s): %s", path, exc)
            return False

    def _run(self) -> None:
        backoff = 2.0
        while self._running.is_set():
            self.connection_state_changed.emit(False, "서버에 연결하는 중입니다…")
            session = requests.Session()
            self._stream_session = session
            try:
                payload = self._fetch_current_state(session)
                if payload is not None:
                    self.connection_state_changed.emit(True, "타이머 정보를 불러왔습니다.")
                    self.timers_updated.emit(payload)
                self._listen_stream(session)
                backoff = 2.0
            except requests.RequestException as exc:
                if not self._running.is_set():
                    break
                logger.warning("타이머 스트림 연결 실패: %s", exc)
                message = "서버 연결이 끊어졌습니다. 잠시 후 다시 시도합니다."
                self.connection_state_changed.emit(False, message)
                time.sleep(min(backoff, 30.0))
                backoff = min(backoff * 2, 30.0)
            finally:
                session.close()
                self._stream_session = None

    def _fetch_current_state(self, session: requests.Session) -> Optional[Dict[str, Any]]:
        url = f"{self._settings.base_url}/api/timers"
        response = session.get(url, timeout=5)
        response.raise_for_status()
        try:
            return response.json()
        except json.JSONDecodeError as exc:
            logger.warning("타이머 상태 응답을 파싱하지 못했습니다: %s", exc)
            return None

    def _listen_stream(self, session: requests.Session) -> None:
        url = f"{self._settings.base_url}/api/timers/stream"
        with session.get(url, stream=True, timeout=(5, 60)) as response:
            response.raise_for_status()
            self.connection_state_changed.emit(True, "실시간 스트림에 연결되었습니다.")
            buffer = ""
            for raw_line in response.iter_lines(decode_unicode=True):
                if not self._running.is_set():
                    break
                if raw_line is None:
                    continue
                line = raw_line.strip("\ufeff")  # BOM 제거
                if not line:
                    if buffer:
                        self._handle_event(buffer.rstrip("\n"))
                        buffer = ""
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("data:"):
                    data_part = line[5:].lstrip()
                    if buffer:
                        buffer += data_part + "\n"
                    else:
                        buffer = data_part + "\n"
                else:
                    continue

    def _handle_event(self, data: str) -> None:
        try:
            payload = json.loads(data)
        except json.JSONDecodeError as exc:
            logger.debug("SSE 데이터 파싱 실패: %s", exc)
            return
        self.timers_updated.emit(payload)
