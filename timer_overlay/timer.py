"""타이머 로직을 담당하는 모듈."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from PyQt5.QtCore import QObject, QTimer, pyqtSignal

from .config import TimerConfig


@dataclass
class TimerCallbacks:
    on_started: Optional[Callable[["TimerController"], None]] = None
    on_reset: Optional[Callable[["TimerController"], None]] = None
    on_tick: Optional[Callable[["TimerController"], None]] = None
    on_completed: Optional[Callable[["TimerController"], None]] = None


class TimerController(QObject):
    """단일 타이머를 제어하는 클래스."""

    remaining_changed = pyqtSignal(int)
    running_changed = pyqtSignal(bool)

    def __init__(self, config: TimerConfig, callbacks: Optional[TimerCallbacks] = None) -> None:
        super().__init__()
        self.config = config
        self._remaining = config.duration_seconds
        self._running = False
        self._callbacks = callbacks or TimerCallbacks()
        self._timer = QTimer(self)
        self._timer.setInterval(1000)
        self._timer.timeout.connect(self._on_tick)

    @property
    def remaining_seconds(self) -> int:
        return self._remaining

    @property
    def is_running(self) -> bool:
        return self._running

    def start(self) -> None:
        self._remaining = max(self._remaining, 0)
        if self._remaining <= 0:
            self.reset()
        if self._running:
            return
        self._running = True
        self._timer.start()
        self.running_changed.emit(True)
        if self._callbacks.on_started:
            self._callbacks.on_started(self)

    def reset(self) -> None:
        self._timer.stop()
        self._remaining = self.config.duration_seconds
        was_running = self._running
        self._running = False
        self.remaining_changed.emit(self._remaining)
        self.running_changed.emit(False)
        if self._callbacks.on_reset:
            self._callbacks.on_reset(self)
        if was_running and self._callbacks.on_tick:
            self._callbacks.on_tick(self)

    def stop(self) -> None:
        self._timer.stop()
        if not self._running:
            return
        self._running = False
        self.running_changed.emit(False)

    def update_duration(self, seconds: int) -> None:
        self.config.duration_seconds = seconds
        self.reset()

    def set_remaining(self, seconds: int) -> None:
        self._remaining = max(0, seconds)
        self.remaining_changed.emit(self._remaining)

    def _on_tick(self) -> None:
        if not self._running:
            return
        self._remaining -= 1
        if self._remaining <= 0:
            self._remaining = 0
            self._timer.stop()
            self._running = False
            self.remaining_changed.emit(self._remaining)
            self.running_changed.emit(False)
            if self._callbacks.on_tick:
                self._callbacks.on_tick(self)
            if self._callbacks.on_completed:
                self._callbacks.on_completed(self)
            return
        self.remaining_changed.emit(self._remaining)
        if self._callbacks.on_tick:
            self._callbacks.on_tick(self)
