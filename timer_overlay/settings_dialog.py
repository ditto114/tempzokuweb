"""설정 다이얼로그 모듈."""
from __future__ import annotations

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QDialog, QDialogButtonBox, QFormLayout, QLabel, QLineEdit,
    QMessageBox, QSpinBox, QVBoxLayout, QWidget
)


class ServerSettingsDialog(QDialog):
    """서버 연결 설정 다이얼로그."""
    
    def __init__(self, parent: QWidget = None, server_url: str = "", channel_code: str = ""):
        super().__init__(parent)
        self.setWindowTitle("서버 설정")
        self.setModal(True)
        self.setMinimumWidth(350)
        
        # 입력 필드
        self._url_input = QLineEdit(server_url)
        self._url_input.setPlaceholderText("https://example.vercel.app")
        
        self._channel_input = QLineEdit(channel_code)
        self._channel_input.setPlaceholderText("채널 코드")
        
        # 버튼
        button_box = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        button_box.accepted.connect(self._on_accept)
        button_box.rejected.connect(self.reject)
        
        # 레이아웃
        form = QFormLayout()
        form.addRow("서버 URL:", self._url_input)
        form.addRow("채널 코드:", self._channel_input)
        
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(button_box)
    
    def _on_accept(self):
        """확인 버튼 클릭."""
        if not self._url_input.text().strip():
            QMessageBox.warning(self, "오류", "서버 URL을 입력해주세요.")
            return
        if not self._channel_input.text().strip():
            QMessageBox.warning(self, "오류", "채널 코드를 입력해주세요.")
            return
        self.accept()
    
    def get_server_url(self) -> str:
        """입력된 서버 URL 반환."""
        return self._url_input.text().strip()
    
    def get_channel_code(self) -> str:
        """입력된 채널 코드 반환."""
        return self._channel_input.text().strip()


class HotkeyCaptureDialog(QDialog):
    """단축키 입력 다이얼로그."""
    
    def __init__(self, parent: QWidget = None, timer_name: str = ""):
        super().__init__(parent)
        self.setWindowTitle("단축키 설정")
        self.setModal(True)
        self.setMinimumWidth(300)
        
        self._captured_key: str = ""
        
        # 안내 라벨
        label = QLabel(f"'{timer_name}' 타이머의 단축키를 누르세요.\n(ESC: 취소, Delete: 해제)")
        label.setAlignment(Qt.AlignCenter)
        
        layout = QVBoxLayout(self)
        layout.addWidget(label)
    
    def keyPressEvent(self, event):
        """키 입력 캡처."""
        key = event.key()
        
        # ESC: 취소
        if key == Qt.Key_Escape:
            self.reject()
            return
        
        # Delete: 단축키 해제
        if key == Qt.Key_Delete or key == Qt.Key_Backspace:
            self._captured_key = ""
            self.accept()
            return
        
        # 일반 키
        text = event.text()
        if text and text.isprintable():
            self._captured_key = text.lower()
            self.accept()
            return
        
        # 특수 키 (F1-F12 등)
        key_name = self._get_key_name(key)
        if key_name:
            self._captured_key = key_name
            self.accept()
    
    def _get_key_name(self, key: int) -> str:
        """Qt 키 코드를 문자열로 변환."""
        key_map = {
            Qt.Key_F1: "f1", Qt.Key_F2: "f2", Qt.Key_F3: "f3", Qt.Key_F4: "f4",
            Qt.Key_F5: "f5", Qt.Key_F6: "f6", Qt.Key_F7: "f7", Qt.Key_F8: "f8",
            Qt.Key_F9: "f9", Qt.Key_F10: "f10", Qt.Key_F11: "f11", Qt.Key_F12: "f12",
        }
        return key_map.get(key, "")
    
    def get_captured_key(self) -> str:
        """캡처된 키 반환 (빈 문자열이면 해제)."""
        return self._captured_key


class DisplaySettingsDialog(QDialog):
    """디스플레이 설정 다이얼로그 (투명도, 크기)."""
    
    def __init__(
        self,
        parent: QWidget = None,
        opacity: int = 100,
        scale: int = 100
    ):
        super().__init__(parent)
        self.setWindowTitle("디스플레이 설정")
        self.setModal(True)
        
        # 투명도 (0-100)
        self._opacity_spin = QSpinBox()
        self._opacity_spin.setRange(20, 100)
        self._opacity_spin.setSuffix("%")
        self._opacity_spin.setValue(opacity)
        
        # 크기 (50-200)
        self._scale_spin = QSpinBox()
        self._scale_spin.setRange(50, 200)
        self._scale_spin.setSuffix("%")
        self._scale_spin.setValue(scale)
        
        # 버튼
        button_box = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        button_box.accepted.connect(self.accept)
        button_box.rejected.connect(self.reject)
        
        # 레이아웃
        form = QFormLayout()
        form.addRow("투명도:", self._opacity_spin)
        form.addRow("크기:", self._scale_spin)
        
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(button_box)
    
    def get_opacity(self) -> int:
        """투명도 반환 (0-100)."""
        return self._opacity_spin.value()
    
    def get_scale(self) -> int:
        """크기 반환 (50-200)."""
        return self._scale_spin.value()
