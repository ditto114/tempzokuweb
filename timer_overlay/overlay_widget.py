"""타이머 오버레이 위젯."""
from __future__ import annotations

from PyQt5.QtCore import QPoint, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QPainter
from PyQt5.QtWidgets import QLabel, QMessageBox, QPushButton, QVBoxLayout, QWidget

from .network import RemoteTimerState, TimerService


class _OverlayProgressBar(QWidget):
    """타이머 진행 상황을 표시하는 간단한 바."""

    def __init__(self) -> None:
        super().__init__()
        self._progress = 0.0
        self._color = QColor("#ffeb3b")
        self.setFixedHeight(6)

    def set_progress(self, value: float) -> None:
        self._progress = max(0.0, min(1.0, value))
        self.update()

    def set_color(self, color: QColor) -> None:
        self._color = color
        self.update()

    def paintEvent(self, event):  # type: ignore[override]
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(self._color)
        painter.setPen(Qt.NoPen)
        width = int(self._progress * self.width())
        rect = self.rect()
        rect.setWidth(width)
        painter.drawRoundedRect(rect, 3, 3)
        super().paintEvent(event)


class TimerOverlayWidget(QWidget):
    """개별 타이머를 화면에 표시하는 오버레이."""

    position_changed = pyqtSignal(int, int)

    def __init__(self, service: TimerService, state: RemoteTimerState):
        super().__init__()
        self._service = service
        self._state = state
        self.timer_id = state.id
        self._drag_position = QPoint()
        self._display_timer = QTimer(self)
        self._display_timer.setInterval(200)
        self._display_timer.timeout.connect(self._update_display)
        self._overlay_opacity = 85

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
        self._default_time_color = QColor("#ffeb3b")
        self._warning_time_color = QColor("#ff5252")
        self._apply_time_color(self._default_time_color)

        self.progress_bar = _OverlayProgressBar()
        self.progress_bar.hide()

        self.action_button = QPushButton()
        self.action_button.clicked.connect(self._handle_action)

        layout = QVBoxLayout()
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)
        layout.addWidget(self.name_label)
        layout.addWidget(self.time_label)
        layout.addWidget(self.progress_bar)
        layout.addWidget(self.action_button)
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
        label = "리셋" if running else "시작"
        self.action_button.setText(label)

    def _handle_action(self) -> None:
        if self._state.is_running:
            success = self._service.reset_timer(self._state.id)
            action = "리셋"
        else:
            success = self._service.start_timer(self._state.id)
            action = "시작"
        if not success:
            QMessageBox.warning(self, "서버", f"타이머 {action} 요청에 실패했습니다.")

    def set_overlay_opacity(self, opacity: int) -> None:
        self._overlay_opacity = max(10, min(100, opacity))
        self.update()

    def _update_display(self) -> None:
        remaining_ms = self._state.remaining_ms_at()
        original_duration = self._state.duration_ms
        duration = max(1, original_duration)
        is_waiting = (
            not self._state.is_running
            and original_duration > 0
            and remaining_ms >= original_duration
        )

        if is_waiting:
            self.time_label.setText("대기중")
        else:
            remaining_text = self._state.format_duration(remaining_ms)
            self.time_label.setText(remaining_text)

        running = self._state.is_running
        if running:
            progress = 1.0 - (remaining_ms / duration)
            self.progress_bar.set_progress(progress)
            warning = remaining_ms < 60_000
            color = self._warning_time_color if warning else self._default_time_color
            self.progress_bar.set_color(color)
            self.progress_bar.show()
            self._apply_time_color(color)
        else:
            self.progress_bar.hide()
            self._apply_time_color(self._default_time_color)

        self._update_running_state()

    # QWidget 이벤트 -------------------------------------------------------
    def paintEvent(self, event):  # type: ignore[override]
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        alpha = int(255 * (self._overlay_opacity / 100))
        color = QColor(20, 20, 20, alpha)
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

    def _apply_time_color(self, color: QColor) -> None:
        self.time_label.setStyleSheet(f"color: {color.name()};")
