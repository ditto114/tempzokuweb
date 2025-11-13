"""글로벌 단축키 관리를 위한 모듈."""
from __future__ import annotations

import logging
import threading
from typing import Callable, Dict, Optional

from PyQt5.QtCore import QTimer
from pynput import keyboard

logger = logging.getLogger(__name__)


class HotkeyManager:
    """pynput을 이용해 글로벌 단축키를 관리한다."""

    def __init__(self) -> None:
        self._registrations: Dict[str, tuple[str, Callable[[], None]]] = {}
        self._listener: Optional[keyboard.GlobalHotKeys] = None
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if self._listener and self._listener.running:
                return
            self._rebuild_listener()

    def stop(self) -> None:
        with self._lock:
            if self._listener:
                self._listener.stop()
                self._listener = None

    def register(self, key: str, hotkey: str, callback: Callable[[], None]) -> None:
        with self._lock:
            self._registrations[key] = (hotkey, callback)
            self._rebuild_listener()

    def unregister(self, key: str) -> None:
        with self._lock:
            if key in self._registrations:
                self._registrations.pop(key)
                self._rebuild_listener()

    def clear(self) -> None:
        with self._lock:
            self._registrations.clear()
            self._rebuild_listener()

    def _rebuild_listener(self) -> None:
        if self._listener:
            self._listener.stop()
            self._listener = None
        mapping: Dict[str, Callable[[], None]] = {}
        duplicated: set[str] = set()
        for hotkey, callback in self._registrations.values():
            if hotkey in mapping:
                duplicated.add(hotkey)
                continue
            mapping[hotkey] = self._wrap_callback(callback)
        if duplicated:
            logger.warning("중복된 단축키는 등록되지 않았습니다: %s", ", ".join(sorted(duplicated)))
        if not mapping:
            return
        self._listener = keyboard.GlobalHotKeys(mapping)
        self._listener.start()

    def _wrap_callback(self, callback: Callable[[], None]) -> Callable[[], None]:
        def _invoke() -> None:
            QTimer.singleShot(0, callback)

        return _invoke
