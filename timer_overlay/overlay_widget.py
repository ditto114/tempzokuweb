"""타이머 오버레이 위젯."""
from __future__ import annotations

from PyQt5.QtCore import QPoint, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QPainter
from PyQt5.QtWidgets import QLabel, QMessageBox, QPushButton, QVBoxLayout, QWidget

from .network import RemoteTimerState, TimerService


class TimerOverlayWidget(QWidget):
    """개별 타이머를 화면에 표시하는 오버레이."""

    position_changed = pyqtSignal(int, int)
    hotkey_config_requested = pyqtSignal(str)

    def __init__(self, service: TimerService, state: RemoteTimerState):
        super().__init__()
        self._service = service
        self._state = state
        self.timer_id = state.id
        self._drag_position = QPoint()
        self._display_timer = QTimer(self)
        self._display_timer.setInterval(200)
        self._display_timer.timeout.connect(self._update_display)

        self.setWindowFlags(
            Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)

        self.name_label = QLabel(state.name)
        self.name_label.setAlignment(Qt.AlignCenter)
        name_font = QFont("Arial", 12, QFont.Bold)
        self.name_label.setFont(name_font)
        self.name_label.setStyleSheet("color: white;")

        self.time_label = QLabel(state.formatted_remaining)
        self.time_label.setAlignment(Qt.AlignCenter)
        time_font = QFont("Consolas", 18, QFont.Bold)
        self.time_label.setFont(time_font)
        self.time_label.setStyleSheet("color: #ffeb3b;")

        self.action_button = QPushButton()
        self.action_button.clicked.connect(self._handle_action)

        self.hotkey_label = QLabel("")
        self.hotkey_label.setAlignment(Qt.AlignCenter)
        hotkey_font = QFont("Arial", 9)
        self.hotkey_label.setFont(hotkey_font)
        self.hotkey_label.setStyleSheet("color: #bdbdbd;")

        self.hotkey_button = QPushButton("단축키 설정")
        self.hotkey_button.clicked.connect(lambda: self.hotkey_config_requested.emit(self.timer_id))

        layout = QVBoxLayout()
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)
        layout.addWidget(self.name_label)
        layout.addWidget(self.time_label)
        layout.addWidget(self.action_button)
        layout.addWidget(self.hotkey_label)
        layout.addWidget(self.hotkey_button)
        self.setLayout(layout)

        self._update_running_state()
        self._update_display()
        self._display_timer.start()

    # 데이터 갱신 ----------------------------------------------------------
    def update_state(self, state: RemoteTimerState) -> None:
        """서버에서 받은 최신 상태로 위젯을 갱신한다."""

        self._state = state
        self.name_label.setText(state.name)
        self._update_running_state()
        self._update_display()

    def _update_running_state(self) -> None:
        running = self._state.is_running
        self.action_button.setText("리셋" if running else "시작")

    def _handle_action(self) -> None:
        if self._state.is_running:
            success = self._service.reset_timer(self._state.id)
            action = "리셋"
        else:
            success = self._service.start_timer(self._state.id)
            action = "시작"
        if not success:
            QMessageBox.warning(self, "서버", f"타이머 {action} 요청에 실패했습니다.")

    def set_hotkey_text(self, text: str) -> None:
        if text:
            self.hotkey_label.setText(f"단축키: {text}")
        else:
            self.hotkey_label.setText("단축키가 설정되어 있지 않습니다.")

    def _update_display(self) -> None:
        remaining_text = self._state.formatted_remaining_at()
        self.time_label.setText(remaining_text)
        self._update_running_state()

    # QWidget 이벤트 -------------------------------------------------------
    def paintEvent(self, event):  # type: ignore[override]
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        color = QColor(20, 20, 20, 210)
        painter.setBrush(color)
        painter.setPen(Qt.NoPen)
        painter.drawRoundedRect(self.rect(), 15, 15)
        super().paintEvent(event)

    def mousePressEvent(self, event):  # type: ignore[override]
        if event.button() == Qt.LeftButton:
            self._drag_position = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):  # type: ignore[override]
        if event.buttons() & Qt.LeftButton:
            self.move(event.globalPos() - self._drag_position)
            event.accept()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):  # type: ignore[override]
        if event.button() == Qt.LeftButton:
            pos = self.pos()
            self.position_changed.emit(pos.x(), pos.y())
            event.accept()
        super().mouseReleaseEvent(event)

    # 위치 제어 ------------------------------------------------------------
    def update_position(self, x: int, y: int) -> None:
        self.move(x, y)

    def current_position(self) -> QPoint:
        return self.pos()
