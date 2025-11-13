"""유틸리티 함수 모음."""
from __future__ import annotations

import re
from typing import List

from PyQt5.QtGui import QKeySequence

_MODIFIER_MAP = {
    "ctrl": "<ctrl>",
    "control": "<ctrl>",
    "alt": "<alt>",
    "shift": "<shift>",
    "meta": "<cmd>",
    "cmd": "<cmd>",
    "command": "<cmd>",
    "option": "<alt>",
    "super": "<cmd>",
}

_SPECIAL_KEY_MAP = {
    "space": "<space>",
    "tab": "<tab>",
    "enter": "<enter>",
    "return": "<enter>",
    "esc": "<esc>",
    "escape": "<esc>",
    "backspace": "<backspace>",
    "delete": "<delete>",
    "home": "<home>",
    "end": "<end>",
    "pageup": "<page_up>",
    "pagedown": "<page_down>",
    "up": "<up>",
    "down": "<down>",
    "left": "<left>",
    "right": "<right>",
}


def qkeysequence_to_hotkey(sequence: QKeySequence) -> str:
    """QKeySequence를 pynput 형식의 문자열로 변환한다."""
    text = sequence.toString(QKeySequence.PortableText)
    if not text:
        return ""
    parts = [part.strip() for part in text.split("+") if part.strip()]
    return normalise_hotkey_parts(parts)


def normalise_hotkey_parts(parts: List[str]) -> str:
    tokens: List[str] = []
    for raw in parts:
        lower = raw.lower()
        if lower in _MODIFIER_MAP:
            tokens.append(_MODIFIER_MAP[lower])
            continue
        if re.fullmatch(r"f\d{1,2}", lower):
            tokens.append(f"<{lower}>")
            continue
        if lower in _SPECIAL_KEY_MAP:
            tokens.append(_SPECIAL_KEY_MAP[lower])
            continue
        if len(lower) == 1:
            tokens.append(lower)
            continue
        tokens.append(lower)
    return "+".join(tokens)


def hotkey_to_display_text(hotkey: str) -> str:
    """pynput 형식의 문자열을 사용자에게 보여줄 수 있도록 변환."""
    if not hotkey:
        return ""
    parts = hotkey.split("+")
    display: List[str] = []
    for part in parts:
        if part.startswith("<") and part.endswith(">"):
            key = part[1:-1]
            if key == "ctrl":
                display.append("Ctrl")
            elif key == "alt":
                display.append("Alt")
            elif key == "shift":
                display.append("Shift")
            elif key in {"cmd", "command"}:
                display.append("Cmd")
            elif key == "space":
                display.append("Space")
            elif key == "enter":
                display.append("Enter")
            elif key == "tab":
                display.append("Tab")
            elif key == "esc":
                display.append("Esc")
            elif key == "backspace":
                display.append("Backspace")
            elif key == "delete":
                display.append("Delete")
            elif key == "page_up":
                display.append("PageUp")
            elif key == "page_down":
                display.append("PageDown")
            elif key in {"up", "down", "left", "right"}:
                display.append(key.capitalize())
            else:
                display.append(key.upper())
        else:
            display.append(part.upper())
    return "+".join(display)
