"""글로벌 단축키 관리를 위한 모듈."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Callable, Dict, Iterable, Optional, Tuple

import keyboard as global_keyboard
from PyQt5.QtCore import QTimer

logger = logging.getLogger(__name__)

_TOKEN_TO_KEYBOARD_KEY = {
    "ctrl": "ctrl",
    "alt": "alt",
    "shift": "shift",
    "cmd": "windows",
    "space": "space",
    "enter": "enter",
    "tab": "tab",
    "esc": "esc",
    "backspace": "backspace",
    "delete": "delete",
    "home": "home",
    "end": "end",
    "page_up": "page up",
    "page_down": "page down",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
}


@dataclass
class _Registration:
    hotkey: str
    callback: Callable[[], None]
    tokens: Tuple[str, ...]
    handler: Optional[int] = None


class HotkeyManager:
    """keyboard 라이브러리를 이용해 글로벌 단축키를 관리한다."""

    def __init__(self) -> None:
        self._registrations: Dict[str, _Registration] = {}
        self._lock = threading.RLock()
        self._active = False

    def start(self) -> None:
        with self._lock:
            if self._active:
                return
            self._active = True
            for registration in self._registrations.values():
                self._attach_registration(registration)

    def stop(self) -> None:
        with self._lock:
            if not self._active:
                return
            for registration in self._registrations.values():
                self._detach_registration(registration)
            self._active = False

    def register(self, key: str, hotkey: str, callback: Callable[[], None]) -> None:
        tokens = self._parse_hotkey(hotkey)
        if not tokens:
            logger.warning("잘못된 단축키 형식: %s", hotkey)
            return
        with self._lock:
            duplicated = [
                other_key
                for other_key, registration in self._registrations.items()
                if other_key != key and registration.hotkey == hotkey
            ]
            if duplicated:
                logger.warning("중복된 단축키는 등록되지 않았습니다: %s", hotkey)
                return

            if key in self._registrations:
                self._detach_registration(self._registrations[key])

            registration = _Registration(
                hotkey=hotkey,
                callback=callback,
                tokens=tokens,
            )
            self._registrations[key] = registration

            if self._active:
                self._attach_registration(registration)

    def unregister(self, key: str) -> None:
        with self._lock:
            registration = self._registrations.pop(key, None)
            if registration is None:
                return
            self._detach_registration(registration)

    def clear(self) -> None:
        with self._lock:
            for registration in self._registrations.values():
                self._detach_registration(registration)
            self._registrations.clear()

    def _attach_registration(self, registration: _Registration) -> None:
        if registration.handler is not None:
            self._detach_registration(registration)
        try:
            hotkey_expression = self._tokens_to_keyboard_expression(registration.tokens)
        except ValueError:
            logger.warning("지원되지 않는 단축키가 등록되었습니다: %s", registration.hotkey)
            return

        try:
            registration.handler = global_keyboard.add_hotkey(
                hotkey_expression,
                lambda callback=registration.callback: self._invoke_callback(callback),
                suppress=False,
                trigger_on_release=False,
            )
        except ValueError as exc:
            logger.warning("단축키 등록 실패(%s): %s", exc, registration.hotkey)

    def _detach_registration(self, registration: _Registration) -> None:
        if registration.handler is None:
            return
        try:
            global_keyboard.remove_hotkey(registration.handler)
        except KeyError:
            logger.debug("이미 제거된 단축키 핸들: %s", registration.hotkey)
        finally:
            registration.handler = None

    def _invoke_callback(self, callback: Callable[[], None]) -> None:
        QTimer.singleShot(0, callback)

    def _parse_hotkey(self, hotkey: str) -> Tuple[str, ...]:
        tokens = []
        for part in hotkey.split("+"):
            token = part.strip().lower()
            if not token:
                continue
            tokens.append(token)
        return tuple(tokens)

    def _tokens_to_keyboard_expression(self, tokens: Iterable[str]) -> str:
        parts = []
        for token in tokens:
            if token.startswith("<") and token.endswith(">"):
                name = token[1:-1]
                if name.startswith("f") and name[1:].isdigit():
                    parts.append(name)
                    continue
                mapped = _TOKEN_TO_KEYBOARD_KEY.get(name)
                if mapped is None:
                    raise ValueError(name)
                parts.append(mapped)
            else:
                parts.append(token)
        if not parts:
            raise ValueError("empty")
        return "+".join(parts)
