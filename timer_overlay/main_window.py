"""메인 윈도우 구현."""
from __future__ import annotations

import logging
import time
from typing import Dict

import requests
from PyQt5.QtCore import QEvent, QTimer, Qt, QPoint
from PyQt5.QtGui import QColor, QGuiApplication, QKeySequence
from PyQt5.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QMenu,
    QPushButton,
    QSlider,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QHeaderView,
)

from timer_overlay.config import AppConfig, ConfigStore
from timer_overlay.key_listener import GlobalKeyListener
from timer_overlay.network import RemoteTimerState, ServerSettings, TimerService
from timer_overlay.overlay_widget import TimerOverlayWidget

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


class ChannelCodeDialog(QDialog):
    """타이머 채널 코드를 받기 위한 다이얼로그."""

    def __init__(self, parent: QWidget | None, default_code: str) -> None:
        super().__init__(parent)
        self.setWindowTitle("채널 코드 확인")
        self._input = QLineEdit(default_code or "")
        self._input.setMaxLength(20)
        self._input.setPlaceholderText("채널 코드를 입력하세요")

        label = QLabel("접속할 채널 코드를 입력해주세요.")
        label.setWordWrap(True)

        form_layout = QVBoxLayout()
        form_layout.addWidget(label)
        form_layout.addWidget(self._input)

        button_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        button_box.accepted.connect(self.accept)
        button_box.rejected.connect(self.reject)

        layout = QVBoxLayout()
        layout.addLayout(form_layout)
        layout.addWidget(button_box)
        self.setLayout(layout)

    def prompt(self) -> str | None:
        self._input.selectAll()
        if self.exec_() != QDialog.Accepted:
            return None
        code = self._input.text().strip()
        return code or None


class HotkeyCaptureDialog(QDialog):
    """사용자로부터 단일 키 입력을 받기 위한 다이얼로그."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("단축키 설정")
        self._label = QLabel("설정할 키를 입력하세요")
        self._label.setAlignment(Qt.AlignCenter)
        layout = QVBoxLayout()
        layout.addWidget(self._label)
        self.setLayout(layout)
        self.setModal(True)
        self._captured: str | None = None

    @property
    def captured_key(self) -> str | None:
        return self._captured

    def keyPressEvent(self, event):  # type: ignore[override]
        key = event.key()
        if key in (Qt.Key_Escape, Qt.Key_Cancel):
            self.reject()
            return
        if key in (
            Qt.Key_Shift,
            Qt.Key_Control,
            Qt.Key_Meta,
            Qt.Key_Alt,
            Qt.Key_AltGr,
            Qt.Key_Super_L,
            Qt.Key_Super_R,
        ):
            return
        modifiers = event.modifiers() & (
            Qt.ControlModifier | Qt.MetaModifier | Qt.AltModifier
        )
        if modifiers:
            return
        sequence = QKeySequence(key).toString()
        if not sequence:
            return
        normalized = sequence.strip().lower()
        if not normalized:
            return
        self._captured = normalized
        self.accept()

class MainWindow(QMainWindow):
    """타이머 오버레이 메인 윈도우."""

    def __init__(self, store: ConfigStore):
        super().__init__()
        self.setWindowTitle("혼테일 타이머 오버레이")
        self.resize(640, 420)

        self.store = store
        self.config = store.load()
        self._server_clock_offset_ms = 0
        self._connected = False

        self.status_label = QLabel("서버에 연결되지 않았습니다.")
        self.status_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

        self.opacity_slider = QSlider(Qt.Horizontal)
        self.opacity_slider.setRange(30, 100)
        initial_opacity = max(30, min(100, self.config.overlay_opacity))
        self.opacity_slider.setValue(initial_opacity)
        self.opacity_slider.setFixedWidth(140)
        self.opacity_slider.valueChanged.connect(self._handle_opacity_changed)
        if self.config.overlay_opacity != initial_opacity:
            self.config.overlay_opacity = initial_opacity
            self.store.save(self.config)

        self.opacity_label = QLabel("오버레이 투명도")
        self.opacity_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

        self.scale_slider = QSlider(Qt.Horizontal)
        self.scale_slider.setRange(1, 5)
        initial_scale = max(1, min(5, getattr(self.config, "overlay_scale", 1)))
        self.scale_slider.setValue(initial_scale)
        self.scale_slider.setFixedWidth(120)
        self.scale_slider.valueChanged.connect(self._handle_scale_changed)
        if getattr(self.config, "overlay_scale", 1) != initial_scale:
            self.config.overlay_scale = initial_scale
            self.store.save(self.config)

        self.scale_label = QLabel("오버레이 크기")
        self.scale_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

        self.disconnect_button = QPushButton("접속 해제")
        self.disconnect_button.setEnabled(False)
        self.disconnect_button.clicked.connect(self._handle_disconnect_clicked)

        self.healthbar_button = QPushButton("체력바")
        self.healthbar_button.setEnabled(False)
        self.healthbar_button.clicked.connect(self._handle_healthbar_clicked)
        self._healthbar_capture_active = False

        header_layout = QHBoxLayout()
        header_layout.addWidget(self.status_label)
        header_layout.addStretch(1)
        header_layout.addWidget(self.opacity_label)
        header_layout.addWidget(self.opacity_slider)
        header_layout.addSpacing(8)
        header_layout.addWidget(self.scale_label)
        header_layout.addWidget(self.scale_slider)
        header_layout.addStretch(1)
        header_layout.addWidget(self.healthbar_button)
        header_layout.addWidget(self.disconnect_button)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["이름", "남은 시간", "상태", "단축키"])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setFocusPolicy(Qt.NoFocus)
        self.table.viewport().installEventFilter(self)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._open_table_context_menu)

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
        self._hotkey_cooldowns: Dict[str, float] = {}

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
        self._apply_server_settings(initial=False, force_prompt=False)

    def _initialize_connection(self) -> None:
        self._apply_server_settings(initial=True, force_prompt=False)

    def _apply_server_settings(self, *, initial: bool, force_prompt: bool) -> None:
        settings = ServerSettings(self.config.server_host, self.config.server_port)
        target_settings = settings if self._test_connection(settings) else self._handle_connection_failure(initial)
        if target_settings is None:
            return

        stored_code = "" if force_prompt else getattr(self.config, "channel_code", "").strip()
        if stored_code:
            if self._verify_channel_code(target_settings, stored_code):
                self._connect_to_channel(target_settings, stored_code)
                return
            QMessageBox.warning(
                self,
                "채널",
                "이전에 저장된 채널 코드가 더 이상 유효하지 않습니다. 다시 입력해주세요.",
            )
            self.config.channel_code = ""
            self.store.save(self.config)

        channel_code = self._prompt_valid_channel_code(target_settings, initial=initial)
        if not channel_code:
            return

        self._connect_to_channel(target_settings, channel_code)

    def _prompt_valid_channel_code(self, settings: ServerSettings, *, initial: bool) -> str | None:
        while True:
            channel_code = self._prompt_channel_code()
            if not channel_code:
                if initial:
                    self.close()
                return None
            if self._verify_channel_code(settings, channel_code):
                return channel_code
            QMessageBox.warning(
                self,
                "채널",
                "유효한 채널 코드를 확인하지 못했습니다. 다시 입력해주세요.",
            )

    def _connect_to_channel(self, settings: ServerSettings, channel_code: str) -> None:
        self.config.channel_code = channel_code
        self.store.save(self.config)
        self._reset_timer_views(remove_positions=False)
        self._start_service(settings, channel_code)
        self.disconnect_button.setEnabled(True)

    def _disconnect_channel(self) -> None:
        self.timer_service.stop()
        self._reset_timer_views(remove_positions=False)
        self.config.channel_code = ""
        self.store.save(self.config)
        self.disconnect_button.setEnabled(False)

    def _handle_disconnect_clicked(self) -> None:
        self._disconnect_channel()
        self.status_label.setText("채널 연결이 해제되었습니다.")
        self.status_label.setStyleSheet("color: #ff9800;")
        self._apply_server_settings(initial=False, force_prompt=True)

    def _handle_healthbar_clicked(self) -> None:
        if self._healthbar_capture_active:
            return
        self._healthbar_capture_active = True
        self.healthbar_button.setEnabled(False)
        self.setCursor(Qt.CrossCursor)
        self.grabMouse()

    def _test_connection(self, settings: ServerSettings) -> bool:
        url = f"{settings.base_url}/api/health"
        try:
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.warning("서버 연결 사전 점검 실패: %s", exc)
            return False

    def _handle_connection_failure(self, initial: bool) -> ServerSettings | None:
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
            return None

        fallback = ServerSettings("localhost", 47984)
        if self._test_connection(fallback):
            self.config.server_host = fallback.host
            self.config.server_port = fallback.port
            self.store.save(self.config)
            return fallback

        QMessageBox.critical(
            self,
            "서버",
            "localhost:47984 서버에 연결하지 못했습니다. 프로그램을 종료합니다.",
        )
        self.close()
        return None

    def _prompt_channel_code(self) -> str | None:
        dialog = ChannelCodeDialog(self, getattr(self.config, "channel_code", ""))
        return dialog.prompt()

    def _verify_channel_code(self, settings: ServerSettings, channel_code: str) -> bool:
        url = f"{settings.base_url}/api/timers"
        try:
            response = requests.get(url, params={"channelCode": channel_code}, timeout=5)
            response.raise_for_status()
            return True
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 404:
                return False
            logger.warning("채널 검증 실패: %s", exc)
            return False
        except requests.RequestException as exc:
            logger.warning("채널 검증 실패: %s", exc)
            return False

    def _start_service(self, settings: ServerSettings, channel_code: str) -> None:
        self.timer_service.update_settings(settings)
        self.timer_service.update_channel_code(channel_code)
        if not self.timer_service.is_running:
            self.timer_service.start()

    def _reset_timer_views(self, *, remove_positions: bool) -> None:
        for timer_id in list(self.overlays.keys()):
            self._hide_overlay(timer_id, remove_position=remove_positions)
        self.timer_states.clear()
        self._table_order = []
        self._row_index = {}
        self.table.setRowCount(0)

    # 타이머 데이터 처리 ----------------------------------------------------
    def _handle_timers_payload(self, payload: Dict) -> None:
        timers_data = payload.get("timers")
        if not isinstance(timers_data, list):
            logger.debug("타이머 데이터 형식이 올바르지 않습니다: %s", payload)
            return

        self._update_server_clock_offset(timers_data)
        updated_states: Dict[str, RemoteTimerState] = {}
        for item in timers_data:
            try:
                state = RemoteTimerState.from_payload(item)
            except Exception as exc:  # pylint: disable=broad-except
                logger.debug("타이머 데이터 파싱 실패: %s", exc)
                continue
            state.server_clock_offset_ms = self._server_clock_offset_ms
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
            overlay.set_hotkey(self._format_hotkey(self.config.timer_hotkeys.get(timer_id)))
            overlay.set_scale(getattr(self.config, "overlay_scale", 1))

    def _cleanup_missing_timers(self, states: Dict[str, RemoteTimerState]) -> None:
        valid_ids = set(states.keys())
        changed = False
        for timer_id in list(self.config.timer_positions.keys()):
            if timer_id not in valid_ids:
                self.config.timer_positions.pop(timer_id, None)
                changed = True
        for timer_id in list(self.config.timer_hotkeys.keys()):
            if timer_id not in valid_ids:
                self.config.timer_hotkeys.pop(timer_id, None)
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
            hotkey_text = self._display_hotkey_text(state.id)
            hotkey_item = QTableWidgetItem(hotkey_text)
            hotkey_item.setTextAlignment(Qt.AlignCenter)
            hotkey_item.setData(Qt.UserRole, state.id)

            self.table.setItem(row, 0, name_item)
            self.table.setItem(row, 1, remaining_item)
            self.table.setItem(row, 2, status_item)
            self.table.setItem(row, 3, hotkey_item)
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
            hotkey_item = self.table.item(row, 3)
            if hotkey_item is not None:
                hotkey_item.setText(self._display_hotkey_text(timer_id))
            self._apply_row_style(row, timer_id)

    def _normalize_hotkey(self, raw: str | None) -> str | None:
        if not raw:
            return None
        normalized = raw.strip().lower()
        return normalized or None

    def _format_hotkey(self, raw: str | None) -> str | None:
        normalized = self._normalize_hotkey(raw)
        if normalized is None:
            return None
        if len(normalized) == 1:
            return normalized.upper()
        if normalized.startswith("f") and normalized[1:].isdigit():
            return normalized.upper()
        return normalized.replace("_", " ").title()

    def _display_hotkey_text(self, timer_id: str) -> str:
        display = self._format_hotkey(self.config.timer_hotkeys.get(timer_id))
        return display if display is not None else "-"

    def _open_table_context_menu(self, position) -> None:
        index = self.table.indexAt(position)
        if not index.isValid():
            return
        row = index.row()
        self.table.selectRow(row)
        item = self.table.item(row, 0)
        timer_id = item.data(Qt.UserRole) if item is not None else None
        if not timer_id:
            return
        menu = QMenu(self)
        action = menu.addAction("단축키 설정")
        action.triggered.connect(lambda: self._assign_hotkey_to_timer(str(timer_id)))
        menu.exec_(self.table.viewport().mapToGlobal(position))

    def _assign_hotkey_to_timer(self, timer_id: str) -> None:
        while True:
            dialog = HotkeyCaptureDialog(self)
            if dialog.exec_() != QDialog.Accepted:
                return
            key = dialog.captured_key
            normalized = self._normalize_hotkey(key)
            if normalized is None:
                return
            in_use = any(
                other_id != timer_id
                and self._normalize_hotkey(value) == normalized
                for other_id, value in self.config.timer_hotkeys.items()
            )
            if in_use:
                QMessageBox.warning(self, "단축키", "이미 사용중인 단축키입니다")
                continue
            self.config.timer_hotkeys[timer_id] = normalized
            self.store.save(self.config)
            self._hotkey_cooldowns.pop(timer_id, None)
            self._update_hotkey_views(timer_id)
            break

    def _update_hotkey_views(self, timer_id: str) -> None:
        row = self._row_index.get(timer_id)
        display_text = self._display_hotkey_text(timer_id)
        if row is not None:
            item = self.table.item(row, 3)
            if item is None:
                item = QTableWidgetItem(display_text)
                item.setTextAlignment(Qt.AlignCenter)
                item.setData(Qt.UserRole, timer_id)
                self.table.setItem(row, 3, item)
            else:
                item.setText(display_text)
        overlay = self.overlays.get(timer_id)
        if overlay is not None:
            overlay.set_hotkey(self._format_hotkey(self.config.timer_hotkeys.get(timer_id)))

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
        overlay = TimerOverlayWidget(
            self.timer_service, state, scale=getattr(self.config, "overlay_scale", 1)
        )
        overlay.position_changed.connect(
            lambda x, y, timer_id=state.id: self._on_overlay_moved(timer_id, x, y)
        )
        position = self.config.timer_positions.get(state.id, (100, 100))
        overlay.update_position(*position)
        overlay.set_overlay_opacity(self.config.overlay_opacity)
        overlay.set_hotkey(self._format_hotkey(self.config.timer_hotkeys.get(state.id)))
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
        normalized = self._normalize_hotkey(key)
        if normalized is None:
            return
        now = time.monotonic()
        for timer_id, assigned in self.config.timer_hotkeys.items():
            if timer_id not in self.overlays:
                continue
            if self._normalize_hotkey(assigned) != normalized:
                continue
            last_triggered = self._hotkey_cooldowns.get(timer_id)
            if last_triggered is not None and (now - last_triggered) < 0.75:
                continue
            state = self.timer_states.get(timer_id)
            if state is None:
                continue
            if state.is_running:
                success = self.timer_service.reset_timer(timer_id)
                action = "리셋"
            else:
                success = self.timer_service.start_timer(timer_id)
                action = "시작"
            if not success:
                QMessageBox.warning(self, "서버", f"타이머 {action} 요청에 실패했습니다.")
                continue
            self._hotkey_cooldowns[timer_id] = now

    # 상태 업데이트 --------------------------------------------------------
    def _handle_connection_state(self, connected: bool, message: str) -> None:
        self._connected = connected
        if message == "실시간 스트림에 연결되었습니다.":
            message = ""
        self.status_label.setText(message)
        self.status_label.setStyleSheet(
            "color: #4caf50;" if connected else "color: #ff9800;"
        )
        self.disconnect_button.setEnabled(connected or bool(self.config.channel_code))
        self.healthbar_button.setEnabled(connected and not self._healthbar_capture_active)
        if not connected:
            self._cancel_healthbar_capture()

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

    def mousePressEvent(self, event):  # type: ignore[override]
        if (
            self._healthbar_capture_active
            and event.button() == Qt.LeftButton
            and isinstance(event.globalPos(), QPoint)
        ):
            position = event.globalPos()
            self._complete_healthbar_capture(position)
            return
        return super().mousePressEvent(event)

    def _apply_row_style(self, row: int, timer_id: str) -> None:
        is_overlay_visible = timer_id in self.overlays
        color = QColor("#ccffcc") if is_overlay_visible else QColor(Qt.white)
        for column in range(self.table.columnCount()):
            item = self.table.item(row, column)
            if item is not None:
                item.setBackground(color)

    def _complete_healthbar_capture(self, position: QPoint) -> None:
        try:
            self.releaseMouse()
            self.unsetCursor()
            self._healthbar_capture_active = False
            self._evaluate_healthbar(position)
        finally:
            self.healthbar_button.setEnabled(self._connected)

    def _cancel_healthbar_capture(self) -> None:
        if not self._healthbar_capture_active:
            return
        self._healthbar_capture_active = False
        self.releaseMouse()
        self.unsetCursor()
        self.healthbar_button.setEnabled(self._connected)

    def _evaluate_healthbar(self, position: QPoint) -> None:
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            QMessageBox.warning(self, "체력바", "화면 정보를 가져올 수 없습니다.")
            return

        screenshot = screen.grabWindow(0)
        image = screenshot.toImage()
        device_ratio = screen.devicePixelRatio()
        x = int(position.x() * device_ratio)
        y = int(position.y() * device_ratio)

        if x < 0 or y < 0 or x >= image.width() or y >= image.height():
            QMessageBox.warning(self, "체력바", "선택한 위치가 화면 범위를 벗어났습니다.")
            return

        base_color = image.pixelColor(x, y)
        a, _, right_edge = self._count_same_color(image, x, y, base_color)

        next_x = right_edge + 1
        if next_x >= image.width():
            QMessageBox.warning(self, "체력바", "오른쪽에 더 이상 픽셀이 없습니다.")
            return

        next_color = image.pixelColor(next_x, y)
        b = self._count_right(image, next_x, y, next_color)

        c = a + b
        if c == 0:
            QMessageBox.warning(self, "체력바", "픽셀 정보를 계산할 수 없습니다.")
            return

        d = (a / c) * 100
        QMessageBox.information(self, "체력바", f"{d:.1f}%")

    def _count_same_color(self, image, x: int, y: int, target_color: QColor) -> tuple[int, int, int]:
        width = image.width()
        left = x
        while left - 1 >= 0 and image.pixelColor(left - 1, y) == target_color:
            left -= 1

        right = x
        while right + 1 < width and image.pixelColor(right + 1, y) == target_color:
            right += 1

        return right - left + 1, left, right

    def _count_right(self, image, x: int, y: int, target_color: QColor) -> int:
        width = image.width()
        count = 0
        position = x
        while position < width and image.pixelColor(position, y) == target_color:
            count += 1
            position += 1
        return count

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

    def _handle_scale_changed(self, value: int) -> None:
        clamped = max(1, min(5, value))
        if getattr(self.config, "overlay_scale", 1) == clamped:
            scale_changed = False
        else:
            self.config.overlay_scale = clamped
            self.store.save(self.config)
            scale_changed = True
        for overlay in self.overlays.values():
            overlay.set_scale(clamped)
        if scale_changed:
            logger.info("오버레이 크기 변경: %s", clamped)

    def _update_server_clock_offset(self, timers_data: list[Dict]) -> None:
        offsets: list[int] = []
        now_ms = int(time.time() * 1000)
        for item in timers_data:
            updated_raw = item.get("updatedAt")
            try:
                updated_at = int(updated_raw)
            except (TypeError, ValueError):
                continue
            offsets.append(updated_at - now_ms)

        if not offsets:
            return

        new_offset = int(sum(offsets) / len(offsets))
        if new_offset == self._server_clock_offset_ms:
            return

        self._server_clock_offset_ms = new_offset
        for state in self.timer_states.values():
            state.server_clock_offset_ms = new_offset
