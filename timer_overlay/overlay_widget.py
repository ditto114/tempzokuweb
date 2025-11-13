"""타이머 오버레이 위젯."""
from __future__ import annotations

from PyQt5.QtCore import QPoint, Qt, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QPainter
from PyQt5.QtWidgets import QLabel, QMessageBox, QPushButton, QVBoxLayout, QWidget

from .network import RemoteTimerState, TimerService


class TimerOverlayWidget(QWidget):
    """개별 타이머를 화면에 표시하는 오버레이."""

    position_changed = pyqtSignal(int, int)

    def __init__(self, service: TimerService, state: RemoteTimerState):
        super().__init__()
        self._service = service
        self._state = state
        self.timer_id = state.id
        self._drag_position = QPoint()

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

        self.start_button = QPushButton()
        self.reset_button = QPushButton("리셋")
        self.start_button.clicked.connect(self._toggle_start)
        self.reset_button.clicked.connect(self._reset_timer)

        layout = QVBoxLayout()
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)
        layout.addWidget(self.name_label)
        layout.addWidget(self.time_label)
        layout.addWidget(self.start_button)
        layout.addWidget(self.reset_button)
        self.setLayout(layout)

        self._update_running_state()

    # 데이터 갱신 ----------------------------------------------------------
    def update_state(self, state: RemoteTimerState) -> None:
        """서버에서 받은 최신 상태로 위젯을 갱신한다."""

        self._state = state
        self.name_label.setText(state.name)
        self.time_label.setText(state.formatted_remaining)
        self._update_running_state()

    def _update_running_state(self) -> None:
        running = self._state.is_running
        self.start_button.setText("정지" if running else "시작")

    def _toggle_start(self) -> None:
        if self._state.is_running:
            success = self._service.pause_timer(self._state.id)
            action = "정지"
        else:
            success = self._service.start_timer(self._state.id)
            action = "시작"
        if not success:
            QMessageBox.warning(self, "서버", f"타이머 {action} 요청에 실패했습니다.")

    def _reset_timer(self) -> None:
        if not self._service.reset_timer(self._state.id):
            QMessageBox.warning(self, "서버", "타이머 리셋 요청에 실패했습니다.")

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
