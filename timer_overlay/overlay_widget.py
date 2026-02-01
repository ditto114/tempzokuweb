"""타이머 오버레이 위젯."""
from __future__ import annotations

from PyQt5.QtCore import QPoint, Qt, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QPainter
from PyQt5.QtWidgets import QLabel, QPushButton, QVBoxLayout, QWidget

from timer_overlay.timer_state import TimerState


class ProgressBar(QWidget):
    """타이머 진행 바."""
    
    def __init__(self, parent: QWidget = None):
        super().__init__(parent)
        self._progress = 0.0
        self._color = QColor("#ffeb3b")
        self.setFixedHeight(6)
    
    def set_progress(self, value: float):
        """진행률 설정 (0.0 ~ 1.0)."""
        self._progress = max(0.0, min(1.0, value))
        self.update()
    
    def set_color(self, color: QColor):
        """바 색상 설정."""
        self._color = color
        self.update()
    
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        # 배경
        painter.fillRect(self.rect(), QColor(50, 50, 50, 180))
        
        # 진행 바
        if self._progress > 0:
            bar_width = int(self.width() * self._progress)
            painter.fillRect(0, 0, bar_width, self.height(), self._color)


class TimerOverlay(QWidget):
    """화면에 표시되는 타이머 오버레이."""
    
    # 시그널
    action_clicked = pyqtSignal(str, str)  # timer_id, action ("start" | "reset")
    position_changed = pyqtSignal(str, int, int)  # timer_id, x, y
    
    # 색상 상수
    COLOR_NORMAL = QColor("#ffeb3b")  # 노란색
    COLOR_CRITICAL = QColor("#ff5252")  # 빨간색
    COLOR_FINISHED = QColor("#4caf50")  # 초록색
    
    def __init__(self, timer: TimerState, scale: float = 1.0, parent: QWidget = None):
        super().__init__(parent)
        
        self.timer_id = timer.id
        self._timer = timer
        self._scale = scale
        self._hotkey_text = ""
        self._drag_start: QPoint = None
        
        # 윈도우 설정
        self.setWindowFlags(
            Qt.FramelessWindowHint |
            Qt.WindowStaysOnTopHint |
            Qt.Tool
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        
        self._setup_ui()
        self._apply_scale()
        self.update_timer(timer)
    
    def _setup_ui(self):
        """UI 구성."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(4)
        
        # 이름 라벨
        self._name_label = QLabel()
        self._name_label.setAlignment(Qt.AlignCenter)
        self._name_label.setStyleSheet("color: white; font-weight: bold;")
        layout.addWidget(self._name_label)
        
        # 시간 라벨
        self._time_label = QLabel("00:00")
        self._time_label.setAlignment(Qt.AlignCenter)
        self._time_label.setStyleSheet("color: #ffeb3b; font-weight: bold;")
        layout.addWidget(self._time_label)
        
        # 진행 바
        self._progress_bar = ProgressBar()
        layout.addWidget(self._progress_bar)
        
        # 액션 버튼
        self._action_btn = QPushButton("시작")
        self._action_btn.setCursor(Qt.PointingHandCursor)
        self._action_btn.clicked.connect(self._on_action_click)
        layout.addWidget(self._action_btn)
        
        # 단축키 라벨
        self._hotkey_label = QLabel("")
        self._hotkey_label.setAlignment(Qt.AlignCenter)
        self._hotkey_label.setStyleSheet("color: #888; font-size: 10px;")
        layout.addWidget(self._hotkey_label)
    
    def _apply_scale(self):
        """스케일 적용."""
        base_width = 140
        base_height = 100
        base_font_size = 10
        base_time_size = 18
        
        width = int(base_width * self._scale)
        height = int(base_height * self._scale)
        font_size = int(base_font_size * self._scale)
        time_size = int(base_time_size * self._scale)
        
        self.setFixedSize(width, height)
        
        # 폰트 크기 조절
        self._name_label.setStyleSheet(
            f"color: white; font-weight: bold; font-size: {font_size}px;"
        )
        self._time_label.setStyleSheet(
            f"color: #ffeb3b; font-weight: bold; font-size: {time_size}px;"
        )
    
    def set_scale(self, scale: float):
        """스케일 변경."""
        self._scale = max(0.5, min(2.0, scale))
        self._apply_scale()
    
    def set_opacity(self, opacity: int):
        """투명도 설정 (0-100)."""
        self.setWindowOpacity(opacity / 100.0)
    
    def set_hotkey(self, key: str):
        """단축키 표시."""
        self._hotkey_text = key or ""
        if key:
            self._hotkey_label.setText(f"[{key.upper()}]")
        else:
            self._hotkey_label.setText("")
    
    def update_timer(self, timer: TimerState):
        """타이머 상태 업데이트."""
        self._timer = timer
        
        # 이름
        self._name_label.setText(timer.name)
        
        # 남은 시간
        remaining_str = timer.get_remaining_str()
        self._time_label.setText(remaining_str)
        
        # 진행률
        progress = timer.get_progress()
        self._progress_bar.set_progress(progress)
        
        # 색상 결정
        remaining_ms = timer.get_remaining_ms()
        if not timer.is_running and remaining_ms == 0:
            color = self.COLOR_FINISHED
        elif remaining_ms > 0 and remaining_ms <= 60000:
            color = self.COLOR_CRITICAL
        else:
            color = self.COLOR_NORMAL
        
        self._time_label.setStyleSheet(
            f"color: {color.name()}; font-weight: bold; font-size: {int(18 * self._scale)}px;"
        )
        self._progress_bar.set_color(color)
        
        # 버튼 텍스트
        if timer.is_running:
            self._action_btn.setText("리셋")
        elif remaining_ms == 0:
            self._action_btn.setText("시작")
        else:
            self._action_btn.setText("시작")
    
    def _on_action_click(self):
        """액션 버튼 클릭."""
        if self._timer.is_running:
            self.action_clicked.emit(self.timer_id, "reset")
        else:
            self.action_clicked.emit(self.timer_id, "start")
    
    def paintEvent(self, event):
        """배경 그리기."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        # 반투명 검은 배경
        painter.setBrush(QColor(0, 0, 0, 180))
        painter.setPen(Qt.NoPen)
        painter.drawRoundedRect(self.rect(), 8, 8)
    
    def mousePressEvent(self, event):
        """드래그 시작."""
        if event.button() == Qt.LeftButton:
            self._drag_start = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()
    
    def mouseMoveEvent(self, event):
        """드래그 중."""
        if self._drag_start and event.buttons() == Qt.LeftButton:
            self.move(event.globalPos() - self._drag_start)
            event.accept()
    
    def mouseReleaseEvent(self, event):
        """드래그 종료."""
        if self._drag_start:
            self._drag_start = None
            pos = self.pos()
            self.position_changed.emit(self.timer_id, pos.x(), pos.y())
            event.accept()
