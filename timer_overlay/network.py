"""서버와의 통신을 담당하는 모듈."""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)


@dataclass
class ServerSettings:
    host: str
    port: int

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"


class ServerClient:
    """타이머 상태를 서버로 전송한다."""

    def __init__(self, settings: ServerSettings) -> None:
        self._settings = settings
        self._queue: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._running = threading.Event()

    def start(self) -> None:
        if self._running.is_set():
            return
        self._running.set()
        if not self._thread.is_alive():
            self._thread = threading.Thread(target=self._worker, daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._running.clear()
        self._queue.put({"type": "__stop__"})
        if self._thread.is_alive():
            self._thread.join(timeout=2)

    def update_settings(self, settings: ServerSettings) -> None:
        logger.debug("서버 설정 업데이트: %s", settings)
        self._settings = settings

    def send_event(self, event_type: str, payload: Optional[Dict[str, Any]] = None) -> None:
        event = {"event_type": event_type, "payload": payload or {}, "timestamp": time.time()}
        self._queue.put(event)

    def _worker(self) -> None:
        while self._running.is_set():
            try:
                event = self._queue.get(timeout=1)
            except queue.Empty:
                continue
            if event.get("type") == "__stop__":
                break
            try:
                self._post_event(event)
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("서버 이벤트 전송 실패: %s", exc)

    def _post_event(self, event: Dict[str, Any]) -> None:
        url = f"{self._settings.base_url}/api/timer/event"
        headers = {"Content-Type": "application/json"}
        response = requests.post(url, data=json.dumps(event), headers=headers, timeout=3)
        response.raise_for_status()
