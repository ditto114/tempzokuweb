"""전역 단축키 관리 모듈."""
from __future__ import annotations

import logging
from typing import Callable, Dict, Optional

from pynput import keyboard

logger = logging.getLogger(__name__)


class HotkeyManager:
    """전역 단축키를 등록하고 관리."""
    
    def __init__(self):
        self._hotkeys: Dict[str, str] = {}  # timer_id -> key
        self._callbacks: Dict[str, Callable[[str], None]] = {}  # key -> callback
        self._listener: Optional[keyboard.Listener] = None
        self._action_callback: Optional[Callable[[str], None]] = None
    
    def set_action_callback(self, callback: Callable[[str], None]):
        """단축키 눌렸을 때 호출될 콜백 설정.
        
        Args:
            callback: timer_id를 인자로 받는 함수
        """
        self._action_callback = callback
    
    def register(self, timer_id: str, key: str):
        """타이머에 단축키 등록."""
        # 기존 키 제거
        self.unregister(timer_id)
        
        # 새 키 등록
        key_lower = key.lower()
        self._hotkeys[timer_id] = key_lower
        logger.info("단축키 등록: %s -> %s", timer_id, key_lower)
    
    def unregister(self, timer_id: str):
        """타이머의 단축키 해제."""
        if timer_id in self._hotkeys:
            key = self._hotkeys.pop(timer_id)
            logger.info("단축키 해제: %s", timer_id)
    
    def get_hotkey(self, timer_id: str) -> Optional[str]:
        """타이머에 등록된 단축키 반환."""
        return self._hotkeys.get(timer_id)
    
    def get_all_hotkeys(self) -> Dict[str, str]:
        """모든 단축키 반환."""
        return self._hotkeys.copy()
    
    def set_hotkeys(self, hotkeys: Dict[str, str]):
        """단축키 일괄 설정."""
        self._hotkeys = {k: v.lower() for k, v in hotkeys.items()}
    
    def start(self):
        """리스너 시작."""
        if self._listener is not None:
            return
        
        self._listener = keyboard.Listener(on_press=self._on_key_press)
        self._listener.start()
        logger.info("단축키 리스너 시작")
    
    def stop(self):
        """리스너 중지."""
        if self._listener is not None:
            self._listener.stop()
            self._listener = None
            logger.info("단축키 리스너 중지")
    
    def _on_key_press(self, key):
        """키 눌림 처리."""
        try:
            # 일반 키
            if hasattr(key, 'char') and key.char:
                pressed_key = key.char.lower()
            # 특수 키 (F1, F2 등)
            elif hasattr(key, 'name'):
                pressed_key = key.name.lower()
            else:
                return
            
            # 등록된 단축키인지 확인
            for timer_id, hotkey in self._hotkeys.items():
                if hotkey == pressed_key:
                    if self._action_callback:
                        self._action_callback(timer_id)
                    break
                    
        except Exception as e:
            logger.warning("단축키 처리 오류: %s", e)
