"""글로벌 단축키 관리를 위한 모듈."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Callable, Dict, Iterable, List, Optional, Set, Tuple

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
    normalized_tokens: Tuple[str, ...]
    active: bool = False


class HotkeyManager:
    """keyboard 라이브러리를 이용해 글로벌 단축키를 관리한다."""

    def __init__(self) -> None:
        self._registrations: Dict[str, _Registration] = {}
        self._lock = threading.RLock()
        self._active = False
        self._hook: Optional[Callable] = None
        self._pressed_keys: Set[str] = set()

    def start(self) -> None:
        with self._lock:
            if self._active:
                return
            callback = self._handle_keyboard_event
            global_keyboard.hook(callback, suppress=False)
            self._hook = callback
            self._active = True

    def stop(self) -> None:
        with self._lock:
            if not self._active:
                return
            if self._hook is not None:
                try:
                    global_keyboard.unhook(self._hook)
                except KeyError:
                    logger.debug("이미 제거된 키보드 후크")
                self._hook = None
            self._pressed_keys.clear()
            for registration in self._registrations.values():
                registration.active = False
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

            existing = self._registrations.get(key)
            if existing is not None:
                existing.active = False

            normalized_tokens = self._normalize_tokens(tokens)
            if normalized_tokens is None:
                logger.warning("지원되지 않는 단축키가 등록되었습니다: %s", hotkey)
                return

            registration = _Registration(
                hotkey=hotkey,
                callback=callback,
                tokens=tokens,
                normalized_tokens=normalized_tokens,
            )
            self._registrations[key] = registration

    def unregister(self, key: str) -> None:
        with self._lock:
            registration = self._registrations.pop(key, None)
            if registration is None:
                return
            registration.active = False

    def clear(self) -> None:
        with self._lock:
            self._registrations.clear()
            self._pressed_keys.clear()

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

    def _normalize_tokens(self, tokens: Iterable[str]) -> Tuple[str, ...] | None:
        normalized: List[str] = []
        for token in tokens:
            normalized_token: Optional[str]
            if token.startswith("<") and token.endswith(">"):
                name = token[1:-1].strip().lower()
                if not name:
                    return None
                if name.startswith("f") and name[1:].isdigit():
                    normalized_token = name
                else:
                    mapped = _TOKEN_TO_KEYBOARD_KEY.get(name)
                    if mapped is None:
                        return None
                    normalized_token = mapped.lower()
            else:
                mapped = _TOKEN_TO_KEYBOARD_KEY.get(token)
                normalized_token = (mapped or token).strip().lower()

            if not normalized_token:
                return None
            normalized.append(normalized_token)

        if not normalized:
            return None

        # 유효성 검사를 위해 표현식을 만들어 본다.
        try:
            self._tokens_to_keyboard_expression(tokens)
        except ValueError:
            return None

        return tuple(normalized)

    def _normalize_event_name(self, name: Optional[str]) -> Optional[str]:
        if not name:
            return None
        lowered = name.lower()
        aliases = {
            "left ctrl": "ctrl",
            "right ctrl": "ctrl",
            "left shift": "shift",
            "right shift": "shift",
            "left alt": "alt",
            "right alt": "alt",
            "alt gr": "alt",
            "left windows": "windows",
            "right windows": "windows",
            "return": "enter",
        }
        if lowered in aliases:
            return aliases[lowered]
        if lowered.startswith("left ") or lowered.startswith("right "):
            base = lowered.split(" ", 1)[1]
            return aliases.get(base, base)
        return lowered

    def _handle_keyboard_event(self, event) -> None:
        if event.event_type not in ("down", "up"):
            return

        normalized_name = self._normalize_event_name(getattr(event, "name", None))
        if normalized_name is None:
            return

        callbacks: List[Callable[[], None]] = []

        with self._lock:
            if not self._active:
                return

            if event.event_type == "down":
                self._pressed_keys.add(normalized_name)
                for registration in self._registrations.values():
                    if not registration.normalized_tokens:
                        continue
                    if all(token in self._pressed_keys for token in registration.normalized_tokens):
                        if not registration.active:
                            registration.active = True
                            callbacks.append(registration.callback)
                    else:
                        registration.active = False
            else:
                if normalized_name in self._pressed_keys:
                    self._pressed_keys.discard(normalized_name)
                for registration in self._registrations.values():
                    if normalized_name in registration.normalized_tokens:
                        registration.active = False

        for callback in callbacks:
            self._invoke_callback(callback)
