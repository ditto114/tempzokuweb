"""글로벌 키 입력을 감지하는 헬퍼."""
from __future__ import annotations

import logging
from typing import Any, Optional

import keyboard
from PyQt5.QtCore import QObject, pyqtSignal

logger = logging.getLogger(__name__)


class GlobalKeyListener(QObject):
    """keyboard 라이브러리를 이용해 특정 키 감지를 지원한다."""

    key_detected = pyqtSignal(str)

    def __init__(self) -> None:
        super().__init__()
        self._handler: Optional[Any] = None

    def start(self) -> None:
        if self._handler is not None:
            return
        try:
            self._handler = keyboard.on_press(self._handle_key_event)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("전역 키 후킹을 시작하지 못했습니다: %s", exc)
            self._handler = None

    def stop(self) -> None:
        if self._handler is None:
            return
        try:
            keyboard.unhook(self._handler)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("전역 키 후킹을 중지하지 못했습니다: %s", exc)
        finally:
            self._handler = None

    def _handle_key_event(self, event: keyboard.KeyboardEvent) -> None:
        name = event.name
        if not name:
            return
        self.key_detected.emit(name.lower())
