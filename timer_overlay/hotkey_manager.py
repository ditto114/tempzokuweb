"""글로벌 단축키 관리를 위한 모듈."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Callable, Dict, Optional, Set

from PyQt5.QtCore import QTimer
from pynput import keyboard

logger = logging.getLogger(__name__)


_KEY_TOKEN_MAP: Dict[keyboard.Key, str] = {
    keyboard.Key.alt: "<alt>",
    keyboard.Key.alt_l: "<alt>",
    keyboard.Key.alt_r: "<alt>",
    keyboard.Key.shift: "<shift>",
    keyboard.Key.shift_l: "<shift>",
    keyboard.Key.shift_r: "<shift>",
    keyboard.Key.ctrl: "<ctrl>",
    keyboard.Key.ctrl_l: "<ctrl>",
    keyboard.Key.ctrl_r: "<ctrl>",
    keyboard.Key.cmd: "<cmd>",
    keyboard.Key.cmd_l: "<cmd>",
    keyboard.Key.cmd_r: "<cmd>",
    keyboard.Key.super: "<cmd>",
    keyboard.Key.space: "<space>",
    keyboard.Key.enter: "<enter>",
    keyboard.Key.tab: "<tab>",
    keyboard.Key.esc: "<esc>",
    keyboard.Key.backspace: "<backspace>",
    keyboard.Key.delete: "<delete>",
    keyboard.Key.home: "<home>",
    keyboard.Key.end: "<end>",
    keyboard.Key.page_up: "<page_up>",
    keyboard.Key.page_down: "<page_down>",
    keyboard.Key.up: "<up>",
    keyboard.Key.down: "<down>",
    keyboard.Key.left: "<left>",
    keyboard.Key.right: "<right>",
}


@dataclass
class _Registration:
    hotkey: str
    callback: Callable[[], None]
    tokens: Set[str]
    active: bool = False


class HotkeyManager:
    """pynput을 이용해 글로벌 단축키를 관리한다."""

    def __init__(self) -> None:
        self._registrations: Dict[str, _Registration] = {}
        self._listener: Optional[keyboard.Listener] = None
        self._lock = threading.RLock()
        self._pressed_tokens: Set[str] = set()

    def start(self) -> None:
        with self._lock:
            if self._listener and self._listener.running:
                return
            self._listener = keyboard.Listener(
                on_press=self._handle_press,
                on_release=self._handle_release,
                suppress=False,
            )
            self._listener.start()

    def stop(self) -> None:
        with self._lock:
            if self._listener:
                self._listener.stop()
                self._listener = None
            self._pressed_tokens.clear()
            for registration in self._registrations.values():
                registration.active = False

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
            self._registrations[key] = _Registration(
                hotkey=hotkey,
                callback=callback,
                tokens=tokens,
            )
            if not self._listener or not self._listener.running:
                self.start()

    def unregister(self, key: str) -> None:
        with self._lock:
            if key in self._registrations:
                self._registrations.pop(key)

    def clear(self) -> None:
        with self._lock:
            self._registrations.clear()
            self._pressed_tokens.clear()

    def _handle_press(self, key: keyboard.Key | keyboard.KeyCode) -> None:
        token = self._token_from_key(key)
        if token is None:
            return
        with self._lock:
            if token in self._pressed_tokens:
                # 이미 눌려 있다고 판단되면 추가 처리 없이 종료
                return
            self._pressed_tokens.add(token)
            for registration in self._registrations.values():
                if registration.tokens.issubset(self._pressed_tokens):
                    if not registration.active:
                        registration.active = True
                        self._invoke_callback(registration.callback)

    def _handle_release(self, key: keyboard.Key | keyboard.KeyCode) -> None:
        token = self._token_from_key(key)
        if token is None:
            return
        with self._lock:
            self._pressed_tokens.discard(token)
            for registration in self._registrations.values():
                if token in registration.tokens:
                    registration.active = False

    def _invoke_callback(self, callback: Callable[[], None]) -> None:
        QTimer.singleShot(0, callback)

    def _parse_hotkey(self, hotkey: str) -> Set[str]:
        tokens = {part.strip() for part in hotkey.split("+") if part.strip()}
        return {token.lower() if not token.startswith("<") else token.lower() for token in tokens}

    def _token_from_key(self, key: keyboard.Key | keyboard.KeyCode) -> Optional[str]:
        if isinstance(key, keyboard.Key):
            token = _KEY_TOKEN_MAP.get(key)
            if token:
                return token
            if key.name and key.name.startswith("f") and key.name[1:].isdigit():
                return f"<{key.name.lower()}>"
            return None
        if isinstance(key, keyboard.KeyCode):
            if key.char:
                return key.char.lower()
            if key.vk is not None:
                # 숫자패드 등 특수키 지원
                if 96 <= key.vk <= 105:
                    return str(key.vk - 96)
                if 48 <= key.vk <= 57:
                    return str(key.vk - 48)
            return None
        return None
