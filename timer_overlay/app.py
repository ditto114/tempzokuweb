"""타이머 오버레이 메인 애플리케이션."""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import (
    QAction, QApplication, QFrame, QGridLayout, QGroupBox, QHBoxLayout,
    QLabel, QMainWindow, QMenu, QMenuBar, QMessageBox, QPushButton,
    QScrollArea, QSlider, QStatusBar, QVBoxLayout, QWidget
)

from timer_overlay.config import AppConfig, ConfigStore
from timer_overlay.hotkey_manager import HotkeyManager
from timer_overlay.overlay_widget import TimerOverlay
from timer_overlay.settings_dialog import (
    DisplaySettingsDialog, HotkeyCaptureDialog, ServerSettingsDialog
)
from timer_overlay.timer_api import TimerAPI
from timer_overlay.timer_poller import TimerPoller
from timer_overlay.timer_state import TimerState

logger = logging.getLogger(__name__)

# 그리드 설정: 한 행에 표시할 타이머 수
TIMERS_PER_ROW = 5


class TimerCard(QFrame):
    """타이머 선택 카드 (메인 윈도우용)."""
    
    def __init__(self, timer: TimerState, parent: QWidget = None):
        super().__init__(parent)
        self.timer_id = timer.id
        self._timer = timer
        
        self.setFrameStyle(QFrame.Box | QFrame.Raised)
        self.setStyleSheet("""
            TimerCard {
                background-color: #2d2d2d;
                border: 1px solid #444;
                border-radius: 6px;
                padding: 8px;
            }
            TimerCard:hover {
                border-color: #ffeb3b;
            }
        """)
        self.setMinimumWidth(140)
        self.setMaximumWidth(180)
        
        self._setup_ui()
        self.update_timer(timer)
    
    def _setup_ui(self):
        """UI 구성."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(4)
        
        # 이름
        self._name_label = QLabel()
        self._name_label.setAlignment(Qt.AlignCenter)
        self._name_label.setStyleSheet("color: white; font-weight: bold; font-size: 11px;")
        self._name_label.setWordWrap(True)
        layout.addWidget(self._name_label)
        
        # 시간
        self._time_label = QLabel("00:00")
        self._time_label.setAlignment(Qt.AlignCenter)
        self._time_label.setStyleSheet("color: #ffeb3b; font-size: 18px; font-weight: bold;")
        layout.addWidget(self._time_label)
        
        # 상태
        self._status_label = QLabel("대기")
        self._status_label.setAlignment(Qt.AlignCenter)
        self._status_label.setStyleSheet("color: #888; font-size: 10px;")
        layout.addWidget(self._status_label)
        
        # 버튼 행
        btn_layout = QHBoxLayout()
        btn_layout.setSpacing(4)
        
        self._action_btn = QPushButton("시작")
        self._action_btn.setFixedHeight(24)
        self._action_btn.setCursor(Qt.PointingHandCursor)
        btn_layout.addWidget(self._action_btn)
        
        self._hotkey_btn = QPushButton("⌨")
        self._hotkey_btn.setFixedSize(24, 24)
        self._hotkey_btn.setToolTip("단축키 설정")
        self._hotkey_btn.setCursor(Qt.PointingHandCursor)
        btn_layout.addWidget(self._hotkey_btn)
        
        self._overlay_btn = QPushButton("📍")
        self._overlay_btn.setFixedSize(24, 24)
        self._overlay_btn.setToolTip("오버레이 표시/숨기기")
        self._overlay_btn.setCursor(Qt.PointingHandCursor)
        btn_layout.addWidget(self._overlay_btn)
        
        layout.addLayout(btn_layout)
        
        # 단축키 표시
        self._hotkey_label = QLabel("")
        self._hotkey_label.setAlignment(Qt.AlignCenter)
        self._hotkey_label.setStyleSheet("color: #666; font-size: 9px;")
        layout.addWidget(self._hotkey_label)
    
    def update_timer(self, timer: TimerState):
        """타이머 상태 업데이트."""
        self._timer = timer
        self._name_label.setText(timer.name)
        self._time_label.setText(timer.get_remaining_str())
        
        remaining_ms = timer.get_remaining_ms()
        
        # 상태 및 색상
        if timer.is_running:
            self._status_label.setText("진행 중")
            if remaining_ms <= 60000:
                self._time_label.setStyleSheet("color: #ff5252; font-size: 18px; font-weight: bold;")
            else:
                self._time_label.setStyleSheet("color: #ffeb3b; font-size: 18px; font-weight: bold;")
            self._action_btn.setText("리셋")
        elif remaining_ms == 0:
            self._status_label.setText("완료")
            self._time_label.setStyleSheet("color: #4caf50; font-size: 18px; font-weight: bold;")
            self._action_btn.setText("시작")
        else:
            self._status_label.setText("대기")
            self._time_label.setStyleSheet("color: #ffeb3b; font-size: 18px; font-weight: bold;")
            self._action_btn.setText("시작")
    
    def set_hotkey_text(self, key: str):
        """단축키 표시."""
        if key:
            self._hotkey_label.setText(f"[{key.upper()}]")
        else:
            self._hotkey_label.setText("")


class TimerOverlayApp(QMainWindow):
    """타이머 오버레이 메인 애플리케이션."""
    
    def __init__(self, config_store: ConfigStore):
        super().__init__()
        
        self.config_store = config_store
        self.config = config_store.load()
        
        # 상태
        self._timers: Dict[str, TimerState] = {}
        self._timer_cards: Dict[str, TimerCard] = {}
        self._overlays: Dict[str, TimerOverlay] = {}
        
        # 서비스
        self._api: Optional[TimerAPI] = None
        self._poller: Optional[TimerPoller] = None
        self._hotkey_manager = HotkeyManager()
        self._hotkey_manager.set_action_callback(self._on_hotkey_pressed)
        self._hotkey_manager.set_hotkeys(self.config.timer_hotkeys)
        
        # UI 초기화
        self._setup_window()
        self._setup_menu()
        self._setup_ui()
        self._setup_status_bar()
        
        # UI 갱신 타이머 (100ms)
        self._ui_timer = QTimer(self)
        self._ui_timer.timeout.connect(self._update_ui)
        self._ui_timer.start(100)
        
        # 초기 연결
        QTimer.singleShot(100, self._initial_connect)
    
    def _setup_window(self):
        """윈도우 설정."""
        self.setWindowTitle("타이머 오버레이")
        self.resize(800, 500)
        self.setMinimumSize(600, 400)
        self.setStyleSheet("""
            QMainWindow {
                background-color: #1e1e1e;
            }
            QLabel {
                color: white;
            }
            QPushButton {
                background-color: #3d3d3d;
                color: white;
                border: 1px solid #555;
                border-radius: 4px;
                padding: 4px 8px;
            }
            QPushButton:hover {
                background-color: #4d4d4d;
                border-color: #ffeb3b;
            }
            QPushButton:pressed {
                background-color: #2d2d2d;
            }
        """)
    
    def _setup_menu(self):
        """메뉴바 설정."""
        menubar = self.menuBar()
        menubar.setStyleSheet("QMenuBar { background-color: #2d2d2d; color: white; }")
        
        # 파일 메뉴
        file_menu = menubar.addMenu("파일")
        
        connect_action = QAction("서버 설정...", self)
        connect_action.triggered.connect(self._show_server_settings)
        file_menu.addAction(connect_action)
        
        file_menu.addSeparator()
        
        exit_action = QAction("종료", self)
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)
        
        # 보기 메뉴
        view_menu = menubar.addMenu("보기")
        
        display_action = QAction("디스플레이 설정...", self)
        display_action.triggered.connect(self._show_display_settings)
        view_menu.addAction(display_action)
    
    def _setup_ui(self):
        """메인 UI 구성."""
        central = QWidget()
        self.setCentralWidget(central)
        
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(16, 16, 16, 16)
        main_layout.setSpacing(16)
        
        # 연결 상태 표시
        header_layout = QHBoxLayout()
        
        self._connection_label = QLabel("연결 안됨")
        self._connection_label.setStyleSheet("color: #ff5252; font-size: 12px;")
        header_layout.addWidget(self._connection_label)
        
        header_layout.addStretch()
        
        # 투명도 슬라이더
        opacity_label = QLabel("투명도:")
        opacity_label.setStyleSheet("color: #888;")
        header_layout.addWidget(opacity_label)
        
        self._opacity_slider = QSlider(Qt.Horizontal)
        self._opacity_slider.setRange(20, 100)
        self._opacity_slider.setValue(self.config.overlay_opacity)
        self._opacity_slider.setFixedWidth(100)
        self._opacity_slider.valueChanged.connect(self._on_opacity_changed)
        header_layout.addWidget(self._opacity_slider)
        
        # 크기 슬라이더
        scale_label = QLabel("크기:")
        scale_label.setStyleSheet("color: #888;")
        header_layout.addWidget(scale_label)
        
        self._scale_slider = QSlider(Qt.Horizontal)
        self._scale_slider.setRange(50, 200)
        self._scale_slider.setValue(int(self.config.overlay_scale * 100))
        self._scale_slider.setFixedWidth(100)
        self._scale_slider.valueChanged.connect(self._on_scale_changed)
        header_layout.addWidget(self._scale_slider)
        
        main_layout.addLayout(header_layout)
        
        # 타이머 그리드
        timer_group = QGroupBox("타이머")
        timer_group.setStyleSheet("""
            QGroupBox {
                color: white;
                font-weight: bold;
                border: 1px solid #444;
                border-radius: 6px;
                margin-top: 12px;
                padding-top: 12px;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background-color: transparent; }")
        
        self._grid_container = QWidget()
        self._grid_layout = QGridLayout(self._grid_container)
        self._grid_layout.setSpacing(12)
        self._grid_layout.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        
        scroll.setWidget(self._grid_container)
        
        group_layout = QVBoxLayout(timer_group)
        group_layout.addWidget(scroll)
        
        main_layout.addWidget(timer_group, 1)
    
    def _setup_status_bar(self):
        """상태 바 설정."""
        self.statusBar().setStyleSheet("QStatusBar { background-color: #2d2d2d; color: #888; }")
        self.statusBar().showMessage("준비")
    
    def _initial_connect(self):
        """초기 서버 연결."""
        server_url = self.config.server_url
        channel_code = self.config.channel_code
        
        if not server_url or not channel_code:
            self._show_server_settings()
        else:
            self._connect(server_url, channel_code)
    
    def _show_server_settings(self):
        """서버 설정 다이얼로그 표시."""
        dialog = ServerSettingsDialog(
            self,
            server_url=self.config.server_url,
            channel_code=self.config.channel_code
        )
        if dialog.exec_() == dialog.Accepted:
            server_url = dialog.get_server_url()
            channel_code = dialog.get_channel_code()
            
            self.config.server_url = server_url
            self.config.channel_code = channel_code
            self.config_store.save(self.config)
            
            self._connect(server_url, channel_code)
    
    def _show_display_settings(self):
        """디스플레이 설정 다이얼로그 표시."""
        dialog = DisplaySettingsDialog(
            self,
            opacity=self.config.overlay_opacity,
            scale=int(self.config.overlay_scale * 100)
        )
        if dialog.exec_() == dialog.Accepted:
            self.config.overlay_opacity = dialog.get_opacity()
            self.config.overlay_scale = dialog.get_scale() / 100.0
            self.config_store.save(self.config)
            
            self._opacity_slider.setValue(self.config.overlay_opacity)
            self._scale_slider.setValue(dialog.get_scale())
            self._apply_display_settings()
    
    def _connect(self, server_url: str, channel_code: str):
        """서버 연결."""
        # 기존 연결 정리
        if self._poller:
            self._poller.stop()
        if self._api:
            self._api.close()
        
        # 새 연결
        self._api = TimerAPI(server_url)
        self._poller = TimerPoller(self._api, channel_code, interval_ms=500, parent=self)
        self._poller.timers_updated.connect(self._on_timers_updated)
        self._poller.connection_changed.connect(self._on_connection_changed)
        self._poller.start()
        
        self._hotkey_manager.start()
        
        self.statusBar().showMessage(f"연결 중: {server_url}")
    
    def _on_timers_updated(self, timers: List[TimerState]):
        """타이머 목록 업데이트 처리."""
        # 상태 저장
        new_timers = {t.id: t for t in timers}
        
        # 삭제된 타이머 제거
        removed_ids = set(self._timers.keys()) - set(new_timers.keys())
        for timer_id in removed_ids:
            self._remove_timer(timer_id)
        
        # 새 타이머 추가/업데이트
        for timer in timers:
            if timer.id not in self._timer_cards:
                self._add_timer_card(timer)
            self._timers[timer.id] = timer
        
        # 그리드 재배치
        self._relayout_grid()
    
    def _add_timer_card(self, timer: TimerState):
        """타이머 카드 추가."""
        card = TimerCard(timer, self._grid_container)
        card._action_btn.clicked.connect(lambda: self._on_action_clicked(timer.id))
        card._hotkey_btn.clicked.connect(lambda: self._on_hotkey_btn_clicked(timer.id))
        card._overlay_btn.clicked.connect(lambda: self._toggle_overlay(timer.id))
        
        # 단축키 표시
        hotkey = self._hotkey_manager.get_hotkey(timer.id)
        card.set_hotkey_text(hotkey or "")
        
        self._timer_cards[timer.id] = card
    
    def _remove_timer(self, timer_id: str):
        """타이머 제거."""
        if timer_id in self._timer_cards:
            card = self._timer_cards.pop(timer_id)
            card.deleteLater()
        if timer_id in self._overlays:
            overlay = self._overlays.pop(timer_id)
            overlay.close()
        if timer_id in self._timers:
            del self._timers[timer_id]
    
    def _relayout_grid(self):
        """그리드 재배치 (5개씩)."""
        # 기존 아이템 제거
        while self._grid_layout.count():
            item = self._grid_layout.takeAt(0)
            if item.widget():
                item.widget().setParent(None)
        
        # 정렬된 순서로 배치
        sorted_ids = sorted(
            self._timer_cards.keys(),
            key=lambda tid: self._timers.get(tid, TimerState("", "", 0, 0, False, False, 999)).display_order
        )
        
        for idx, timer_id in enumerate(sorted_ids):
            row = idx // TIMERS_PER_ROW
            col = idx % TIMERS_PER_ROW
            card = self._timer_cards[timer_id]
            self._grid_layout.addWidget(card, row, col)
    
    def _update_ui(self):
        """UI 주기적 갱신 (100ms)."""
        for timer_id, timer in self._timers.items():
            # 카드 업데이트
            if timer_id in self._timer_cards:
                self._timer_cards[timer_id].update_timer(timer)
            
            # 오버레이 업데이트
            if timer_id in self._overlays:
                self._overlays[timer_id].update_timer(timer)
    
    def _on_action_clicked(self, timer_id: str):
        """액션 버튼 클릭."""
        timer = self._timers.get(timer_id)
        if not timer or not self._api:
            return
        
        if timer.is_running:
            self._api.reset_timer(self.config.channel_code, timer_id)
        else:
            self._api.start_timer(self.config.channel_code, timer_id)
    
    def _on_hotkey_btn_clicked(self, timer_id: str):
        """단축키 버튼 클릭."""
        timer = self._timers.get(timer_id)
        if not timer:
            return
        
        dialog = HotkeyCaptureDialog(self, timer.name)
        if dialog.exec_() == dialog.Accepted:
            key = dialog.get_captured_key()
            if key:
                self._hotkey_manager.register(timer_id, key)
            else:
                self._hotkey_manager.unregister(timer_id)
            
            # 설정 저장
            self.config.timer_hotkeys = self._hotkey_manager.get_all_hotkeys()
            self.config_store.save(self.config)
            
            # UI 업데이트
            if timer_id in self._timer_cards:
                self._timer_cards[timer_id].set_hotkey_text(key)
            if timer_id in self._overlays:
                self._overlays[timer_id].set_hotkey(key)
    
    def _toggle_overlay(self, timer_id: str):
        """오버레이 표시/숨기기."""
        timer = self._timers.get(timer_id)
        if not timer:
            return
        
        if timer_id in self._overlays:
            # 숨기기
            overlay = self._overlays.pop(timer_id)
            overlay.close()
        else:
            # 표시
            overlay = TimerOverlay(
                timer,
                scale=self.config.overlay_scale,
                parent=None
            )
            overlay.set_opacity(self.config.overlay_opacity)
            overlay.set_hotkey(self._hotkey_manager.get_hotkey(timer_id))
            overlay.action_clicked.connect(self._on_overlay_action)
            overlay.position_changed.connect(self._on_overlay_position_changed)
            
            # 저장된 위치 복원
            pos = self.config.timer_positions.get(timer_id)
            if pos:
                overlay.move(pos[0], pos[1])
            
            overlay.show()
            self._overlays[timer_id] = overlay
    
    def _on_overlay_action(self, timer_id: str, action: str):
        """오버레이 액션 처리."""
        if not self._api:
            return
        
        if action == "start":
            self._api.start_timer(self.config.channel_code, timer_id)
        elif action == "reset":
            self._api.reset_timer(self.config.channel_code, timer_id)
    
    def _on_overlay_position_changed(self, timer_id: str, x: int, y: int):
        """오버레이 위치 변경 저장."""
        self.config.timer_positions[timer_id] = (x, y)
        self.config_store.save(self.config)
    
    def _on_hotkey_pressed(self, timer_id: str):
        """단축키 눌림."""
        self._on_action_clicked(timer_id)
    
    def _on_connection_changed(self, connected: bool, message: str):
        """연결 상태 변경."""
        if connected:
            self._connection_label.setText("연결됨")
            self._connection_label.setStyleSheet("color: #4caf50; font-size: 12px;")
        else:
            self._connection_label.setText(message)
            self._connection_label.setStyleSheet("color: #ff5252; font-size: 12px;")
    
    def _on_opacity_changed(self, value: int):
        """투명도 변경."""
        self.config.overlay_opacity = value
        self.config_store.save(self.config)
        
        for overlay in self._overlays.values():
            overlay.set_opacity(value)
    
    def _on_scale_changed(self, value: int):
        """크기 변경."""
        scale = value / 100.0
        self.config.overlay_scale = scale
        self.config_store.save(self.config)
        
        for overlay in self._overlays.values():
            overlay.set_scale(scale)
    
    def _apply_display_settings(self):
        """디스플레이 설정 적용."""
        for overlay in self._overlays.values():
            overlay.set_opacity(self.config.overlay_opacity)
            overlay.set_scale(self.config.overlay_scale)
    
    def closeEvent(self, event):
        """종료 처리."""
        self._hotkey_manager.stop()
        
        if self._poller:
            self._poller.stop()
        if self._api:
            self._api.close()
        
        # 오버레이 닫기
        for overlay in list(self._overlays.values()):
            overlay.close()
        
        event.accept()
