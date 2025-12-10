"""체력바 오버레이 위젯."""
from __future__ import annotations

from PyQt5.QtCore import QRect, Qt
from PyQt5.QtGui import QColor, QFont, QPainter, QPen
from PyQt5.QtWidgets import QWidget


class HealthbarOverlayWidget(QWidget):
    """체력바 영역과 남은 체력을 표시하는 오버레이."""

    def __init__(self) -> None:
        super().__init__()
        self._percent = 0.0
        self._padding = 6
        self._label_margin = 20
        self._bar_rect: QRect | None = None
        self._border_color = QColor("#ff5252")
        self._text_color = QColor("#ffffff")

        self.setWindowFlags(
            Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)

    def update_overlay(self, bar_rect: QRect, percent: float) -> None:
        """바 위치와 퍼센트를 갱신한다."""

        self._percent = max(0.0, percent)
        # 위쪽에 텍스트를 올릴 공간을 더 확보한 뒤, 내부 바 영역 좌표를 별도로 저장한다.
        widget_rect = bar_rect.adjusted(
            -self._padding,
            -self._label_margin,
            self._padding,
            self._padding,
        )
        self.setGeometry(widget_rect)
        self._bar_rect = QRect(
            self._padding,
            self._label_margin,
            bar_rect.width(),
            bar_rect.height(),
        )
        self.show()
        self.update()

    def set_percent(self, percent: float) -> None:
        self._percent = max(0.0, percent)
        self.update()

    def paintEvent(self, event):  # type: ignore[override]
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        if self._bar_rect is not None:
            pen = QPen(self._border_color, 3)
            painter.setPen(pen)
            painter.setBrush(Qt.NoBrush)
            painter.drawRect(self._bar_rect.adjusted(1, 1, -1, -1))

        painter.setPen(QPen(self._text_color))
        font = QFont("Arial", 14, QFont.Bold)
        painter.setFont(font)
        text_rect = self.rect().adjusted(0, 2, 0, 0)
        painter.drawText(text_rect, Qt.AlignHCenter | Qt.AlignTop, f"{self._percent:.1f}%")

        super().paintEvent(event)
