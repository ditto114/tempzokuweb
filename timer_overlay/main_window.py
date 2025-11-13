"""메인 윈도우 구현."""
from __future__ import annotations

import logging
import time
from typing import Dict

import requests
from PyQt5.QtCore import QEvent, QTimer, Qt
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSlider,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QHeaderView,
)

from .config import AppConfig, ConfigStore
from .key_listener import GlobalKeyListener
from .network import RemoteTimerState, ServerSettings, TimerService
from .overlay_widget import TimerOverlayWidget

logger = logging.getLogger(__name__)


class ServerSettingsDialog(QDialog):
    """서버 연결 정보를 입력하는 다이얼로그."""

    def __init__(self, parent: QWidget | None, config: AppConfig):
        super().__init__(parent)
        self.setWindowTitle("서버 설정")
        self.host_edit = QLineEdit(config.server_host)
        self.port_spin = QSpinBox()
        self.port_spin.setRange(1, 65535)
        self.port_spin.setValue(config.server_port)

        form = QFormLayout()
        form.addRow("호스트", self.host_edit)
        form.addRow("포트", self.port_spin)

        button_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        button_box.accepted.connect(self.accept)
        button_box.rejected.connect(self.reject)

        layout = QVBoxLayout()
        layout.addLayout(form)
        layout.addWidget(button_box)
        self.setLayout(layout)

    def apply(self, config: AppConfig) -> bool:
        if self.exec_() != QDialog.Accepted:
            return False
        config.server_host = self.host_edit.text().strip() or "218.234.230.188"
        config.server_port = self.port_spin.value()
        return True


class MainWindow(QMainWindow):
    """타이머 오버레이 메인 윈도우."""

    def __init__(self, store: ConfigStore):
        super().__init__()
        self.setWindowTitle("혼테일 타이머 오버레이")
        self.resize(640, 420)

        self.store = store
        self.config = store.load()
        self.status_label = QLabel("서버에 연결되지 않았습니다.")
        self.status_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

        self._default_key_status = "Q 대기"
        self.key_status_label = QLabel(self._default_key_status)
        self.key_status_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.key_status_label.setStyleSheet("color: #bdbdbd;")
        self._key_status_reset_timer = QTimer(self)
        self._key_status_reset_timer.setSingleShot(True)
        self._key_status_reset_timer.timeout.connect(self._reset_key_status)

        self.opacity_slider = QSlider(Qt.Horizontal)
        self.opacity_slider.setRange(30, 100)
        initial_opacity = max(30, min(100, self.config.overlay_opacity))
        self.opacity_slider.setValue(initial_opacity)
        self.opacity_slider.setFixedWidth(180)
        self.opacity_slider.valueChanged.connect(self._handle_opacity_changed)
        if self.config.overlay_opacity != initial_opacity:
            self.config.overlay_opacity = initial_opacity
            self.store.save(self.config)

        self.opacity_label = QLabel("오버레이 투명도")
        self.opacity_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

        header_layout = QHBoxLayout()
        header_layout.addWidget(self.status_label)
        header_layout.addStretch(1)
        header_layout.addWidget(self.opacity_label)
        header_layout.addWidget(self.opacity_slider)
        header_layout.addStretch(1)
        header_layout.addWidget(self.key_status_label)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["이름", "남은 시간", "상태"])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setFocusPolicy(Qt.NoFocus)
        self.table.viewport().installEventFilter(self)

        layout = QVBoxLayout()
        layout.addLayout(header_layout)
        layout.addWidget(self.table)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        settings = ServerSettings(self.config.server_host, self.config.server_port)
        self.timer_service = TimerService(settings)
        self.timer_service.timers_updated.connect(self._handle_timers_payload)
        self.timer_service.connection_state_changed.connect(self._handle_connection_state)

        self.overlays: Dict[str, TimerOverlayWidget] = {}
        self.timer_states: Dict[str, RemoteTimerState] = {}
        self._table_order: list[str] = []
        self._row_index: Dict[str, int] = {}

        self.key_listener = GlobalKeyListener()
        self.key_listener.key_detected.connect(self._handle_key_detected)
        self.key_listener.start()

        self._table_update_timer = QTimer(self)
        self._table_update_timer.setInterval(250)
        self._table_update_timer.timeout.connect(self._update_table_remaining)
        self._table_update_timer.start()

        QTimer.singleShot(0, self._initialize_connection)

    # UI 핸들러 -------------------------------------------------------------
    def _open_server_settings_dialog(self) -> None:
        dialog = ServerSettingsDialog(self, self.config)
        if not dialog.apply(self.config):
            return

        self.store.save(self.config)
        self._apply_server_settings(initial=False)

    def _initialize_connection(self) -> None:
        self._apply_server_settings(initial=True)

    def _apply_server_settings(self, *, initial: bool) -> None:
        settings = ServerSettings(self.config.server_host, self.config.server_port)
        if self._test_connection(settings):
            self._start_service(settings)
            return

        if not self._handle_connection_failure(initial):
            return

    def _test_connection(self, settings: ServerSettings) -> bool:
        url = f"{settings.base_url}/api/timers"
        try:
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.warning("서버 연결 사전 점검 실패: %s", exc)
            return False

    def _handle_connection_failure(self, initial: bool) -> bool:
        message_box = QMessageBox(self)
        message_box.setIcon(QMessageBox.Warning)
        message_box.setWindowTitle("서버 연결 실패")
        message_box.setText(
            "인터넷에 연결되어있지 않거나 서버가 켜져있지 않은것 같아요. 제작자에게 문의주세요. -대칭-"
        )
        retry_button = message_box.addButton("확인", QMessageBox.AcceptRole)
        message_box.exec_()
        if message_box.clickedButton() is not retry_button:
            if initial:
                self.close()
            return False

        fallback = ServerSettings("localhost", 47984)
        if self._test_connection(fallback):
            self.config.server_host = fallback.host
            self.config.server_port = fallback.port
            self.store.save(self.config)
            self._start_service(fallback)
            return True

        QMessageBox.critical(
            self,
            "서버",
            "localhost:47984 서버에 연결하지 못했습니다. 프로그램을 종료합니다.",
        )
        self.close()
        return False

    def _start_service(self, settings: ServerSettings) -> None:
        self.timer_service.update_settings(settings)
        if not self.timer_service.is_running:
            self.timer_service.start()

    # 타이머 데이터 처리 ----------------------------------------------------
    def _handle_timers_payload(self, payload: Dict) -> None:
        timers_data = payload.get("timers")
        if not isinstance(timers_data, list):
            logger.debug("타이머 데이터 형식이 올바르지 않습니다: %s", payload)
            return

        updated_states: Dict[str, RemoteTimerState] = {}
        for item in timers_data:
            try:
                state = RemoteTimerState.from_payload(item)
            except Exception as exc:  # pylint: disable=broad-except
                logger.debug("타이머 데이터 파싱 실패: %s", exc)
                continue
            updated_states[state.id] = state

        self.timer_states = updated_states
        self._update_visible_overlays()
        self._cleanup_missing_timers(updated_states)
        self._refresh_table()

    def _update_visible_overlays(self) -> None:
        for timer_id, overlay in list(self.overlays.items()):
            state = self.timer_states.get(timer_id)
            if state is None:
                self._hide_overlay(timer_id, remove_position=True)
                continue
            overlay.update_state(state)
            overlay.set_overlay_opacity(self.config.overlay_opacity)

    def _cleanup_missing_timers(self, states: Dict[str, RemoteTimerState]) -> None:
        valid_ids = set(states.keys())
        changed = False
        for timer_id in list(self.config.timer_positions.keys()):
            if timer_id not in valid_ids:
                self.config.timer_positions.pop(timer_id, None)
                changed = True
        if changed:
            self.store.save(self.config)

    def _refresh_table(self) -> None:
        states = sorted(self.timer_states.values(), key=lambda item: item.sort_index)
        self._table_order = [state.id for state in states]
        self.table.setRowCount(len(states))
        now = time.monotonic()
        self._row_index = {}
        for row, state in enumerate(states):
            name_item = QTableWidgetItem(state.name)
            name_item.setData(Qt.UserRole, state.id)
            remaining_item = QTableWidgetItem(state.formatted_remaining_at(now))
            remaining_item.setTextAlignment(Qt.AlignCenter)
            remaining_item.setData(Qt.UserRole, state.id)
            remaining_ms = state.remaining_ms_at(now)
            status_text = "진행 중" if state.is_running else ("완료" if remaining_ms == 0 else "대기")
            status_item = QTableWidgetItem(status_text)
            status_item.setTextAlignment(Qt.AlignCenter)
            status_item.setData(Qt.UserRole, state.id)

            self.table.setItem(row, 0, name_item)
            self.table.setItem(row, 1, remaining_item)
            self.table.setItem(row, 2, status_item)
            self._row_index[state.id] = row
            self._apply_row_style(row, state.id)

    def _update_table_remaining(self) -> None:
        if not self._table_order:
            return
        now = time.monotonic()
        for row, timer_id in enumerate(self._table_order):
            state = self.timer_states.get(timer_id)
            if state is None:
                continue
            remaining_item = self.table.item(row, 1)
            if remaining_item is not None:
                remaining_item.setText(state.formatted_remaining_at(now))
            status_item = self.table.item(row, 2)
            if status_item is not None:
                remaining_ms = state.remaining_ms_at(now)
                status_text = "진행 중" if state.is_running else ("완료" if remaining_ms == 0 else "대기")
                status_item.setText(status_text)
            self._apply_row_style(row, timer_id)

    def _toggle_overlay(self, row: int) -> None:
        if row < 0 or row >= len(self._table_order):
            return
        timer_id = self._table_order[row]
        if timer_id in self.overlays:
            self._hide_overlay(timer_id)
        else:
            state = self.timer_states.get(timer_id)
            if state is None:
                return
            self._show_overlay(state)

    def _show_overlay(self, state: RemoteTimerState) -> None:
        overlay = TimerOverlayWidget(self.timer_service, state)
        overlay.position_changed.connect(
            lambda x, y, timer_id=state.id: self._on_overlay_moved(timer_id, x, y)
        )
        position = self.config.timer_positions.get(state.id, (100, 100))
        overlay.update_position(*position)
        overlay.set_overlay_opacity(self.config.overlay_opacity)
        overlay.show()
        self.overlays[state.id] = overlay
        if state.id not in self.config.timer_positions:
            self.config.timer_positions[state.id] = position
            self.store.save(self.config)
        self._update_row_background(state.id)

    def _hide_overlay(self, timer_id: str, *, remove_position: bool = False) -> None:
        overlay = self.overlays.pop(timer_id, None)
        if overlay is None:
            return
        pos = overlay.current_position()
        changed = False
        if remove_position:
            if timer_id in self.config.timer_positions:
                self.config.timer_positions.pop(timer_id, None)
                changed = True
        else:
            self.config.timer_positions[timer_id] = (pos.x(), pos.y())
            changed = True
        overlay.close()
        if changed:
            self.store.save(self.config)
        self._update_row_background(timer_id)

    def _handle_key_detected(self, key: str) -> None:
        if key != "q":
            return
        self.key_status_label.setText("Q 감지")
        self.key_status_label.setStyleSheet("color: #4caf50;")
        self._key_status_reset_timer.start(1500)

    def _reset_key_status(self) -> None:
        self.key_status_label.setText(self._default_key_status)
        self.key_status_label.setStyleSheet("color: #bdbdbd;")

    # 상태 업데이트 --------------------------------------------------------
    def _handle_connection_state(self, connected: bool, message: str) -> None:
        if message == "실시간 스트림에 연결되었습니다.":
            message = ""
        self.status_label.setText(message)
        self.status_label.setStyleSheet(
            "color: #4caf50;" if connected else "color: #ff9800;"
        )

    def _on_overlay_moved(self, timer_id: str, x: int, y: int) -> None:
        self.config.timer_positions[timer_id] = (x, y)
        self.store.save(self.config)

    def _capture_positions(self) -> None:
        for timer_id, overlay in self.overlays.items():
            pos = overlay.current_position()
            self.config.timer_positions[timer_id] = (pos.x(), pos.y())

    # 윈도우 수명주기 -------------------------------------------------------
    def closeEvent(self, event):  # type: ignore[override]
        self._capture_positions()
        self.store.save(self.config)
        self.timer_service.stop()
        self.key_listener.stop()
        self._table_update_timer.stop()
        for overlay in self.overlays.values():
            overlay.close()
        super().closeEvent(event)

    # 이벤트 필터 ----------------------------------------------------------
    def eventFilter(self, source, event):  # type: ignore[override]
        if source is self.table.viewport() and event.type() == QEvent.MouseButtonPress:
            mouse_event = event
            index = self.table.indexAt(mouse_event.pos())
            if index.isValid() and mouse_event.button() == Qt.LeftButton:
                row = index.row()
                self.table.selectRow(row)
                self._toggle_overlay(row)
                return True
        return super().eventFilter(source, event)

    def _apply_row_style(self, row: int, timer_id: str) -> None:
        is_overlay_visible = timer_id in self.overlays
        color = QColor("#ccffcc") if is_overlay_visible else QColor(Qt.white)
        for column in range(self.table.columnCount()):
            item = self.table.item(row, column)
            if item is not None:
                item.setBackground(color)

    def _update_row_background(self, timer_id: str) -> None:
        row = self._row_index.get(timer_id)
        if row is None:
            return
        self._apply_row_style(row, timer_id)

    def _handle_opacity_changed(self, value: int) -> None:
        clamped = max(30, min(100, value))
        if self.config.overlay_opacity == clamped:
            opacity_changed = False
        else:
            self.config.overlay_opacity = clamped
            self.store.save(self.config)
            opacity_changed = True
        for overlay in self.overlays.values():
            overlay.set_overlay_opacity(clamped)
        if opacity_changed:
            logger.info("오버레이 투명도 변경: %s", clamped)
