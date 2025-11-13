"""타이머 오버레이 위젯."""
from __future__ import annotations

from PyQt5.QtCore import QPoint, Qt, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QPainter
from PyQt5.QtWidgets import QLabel, QPushButton, QVBoxLayout, QWidget

from .timer import TimerController


class TimerOverlayWidget(QWidget):
    """개별 타이머를 화면에 표시하는 오버레이."""

    position_changed = pyqtSignal(int, int)

    def __init__(self, controller: TimerController):
        super().__init__()
        self.controller = controller
        self._drag_position = QPoint()
        self.setWindowFlags(
            Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)

        self.name_label = QLabel(controller.config.name)
        self.name_label.setAlignment(Qt.AlignCenter)
        font = QFont("Arial", 12, QFont.Bold)
        self.name_label.setFont(font)
        self.name_label.setStyleSheet("color: white;")

        self.time_label = QLabel(self._format_time(controller.remaining_seconds))
        self.time_label.setAlignment(Qt.AlignCenter)
        time_font = QFont("Consolas", 18, QFont.Bold)
        self.time_label.setFont(time_font)
        self.time_label.setStyleSheet("color: #ffeb3b;")

        self.start_button = QPushButton("시작")
        self.reset_button = QPushButton("리셋")
        self.start_button.clicked.connect(controller.start)
        self.reset_button.clicked.connect(controller.reset)

        layout = QVBoxLayout()
        layout.setContentsMargins(12, 12, 12, 12)
        layout.addWidget(self.name_label)
        layout.addWidget(self.time_label)
        layout.addWidget(self.start_button)
        layout.addWidget(self.reset_button)
        self.setLayout(layout)

        controller.remaining_changed.connect(self._on_remaining_changed)
        controller.running_changed.connect(self._on_running_changed)

        self._update_running_state(controller.is_running)

    def _format_time(self, seconds: int) -> str:
        minutes, secs = divmod(max(0, seconds), 60)
        hours, minutes = divmod(minutes, 60)
        if hours:
            return f"{hours:02}:{minutes:02}:{secs:02}"
        return f"{minutes:02}:{secs:02}"

    def _on_remaining_changed(self, seconds: int) -> None:
        self.time_label.setText(self._format_time(seconds))

    def _on_running_changed(self, running: bool) -> None:
        self._update_running_state(running)

    def _update_running_state(self, running: bool) -> None:
        self.start_button.setText("정지" if running else "시작")
        try:
            self.start_button.clicked.disconnect()
        except TypeError:
            pass
        if running:
            self.start_button.clicked.connect(self.controller.stop)
        else:
            self.start_button.clicked.connect(self.controller.start)

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

    def update_position(self, x: int, y: int) -> None:
        self.move(x, y)

    def current_position(self) -> QPoint:
        return self.pos()
