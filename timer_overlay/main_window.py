"""메인 윈도우 구현."""
from __future__ import annotations

import logging
from typing import Dict

from PyQt5.QtCore import QTimer, Qt
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
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QHeaderView,
)

from .config import AppConfig, ConfigStore
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
        config.server_host = self.host_edit.text().strip() or "localhost"
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

        self.connect_button = QPushButton("서버 설정")
        self.connect_button.clicked.connect(self._open_server_settings_dialog)

        header_layout = QHBoxLayout()
        header_layout.addWidget(self.status_label)
        header_layout.addStretch(1)
        header_layout.addWidget(self.connect_button)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["이름", "남은 시간", "상태"])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionMode(QTableWidget.NoSelection)
        self.table.setFocusPolicy(Qt.NoFocus)

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

        QTimer.singleShot(0, lambda: self._open_server_settings_dialog(initial=True))

    # UI 핸들러 -------------------------------------------------------------
    def _open_server_settings_dialog(self, initial: bool = False) -> None:
        dialog = ServerSettingsDialog(self, self.config)
        if not dialog.apply(self.config):
            if initial:
                QMessageBox.warning(self, "서버", "서버 정보가 설정되지 않아 프로그램을 종료합니다.")
                self.close()
            return

        self.store.save(self.config)
        self._apply_server_settings()
        if initial:
            QMessageBox.information(self, "서버", "서버 연결을 시도합니다.")

    def _apply_server_settings(self) -> None:
        settings = ServerSettings(self.config.server_host, self.config.server_port)
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
            self._ensure_overlay(state)

        self._remove_missing_overlays(updated_states)
        self.timer_states = updated_states
        self._refresh_table()

    def _ensure_overlay(self, state: RemoteTimerState) -> None:
        overlay = self.overlays.get(state.id)
        if overlay is None:
            overlay = TimerOverlayWidget(self.timer_service, state)
            overlay.position_changed.connect(
                lambda x, y, timer_id=state.id: self._on_overlay_moved(timer_id, x, y)
            )
            position = self.config.timer_positions.get(state.id, (100, 100))
            overlay.update_position(*position)
            overlay.show()
            self.overlays[state.id] = overlay
            self.config.timer_positions.setdefault(state.id, position)
        else:
            overlay.update_state(state)

    def _remove_missing_overlays(self, states: Dict[str, RemoteTimerState]) -> None:
        for timer_id in list(self.overlays.keys()):
            if timer_id not in states:
                overlay = self.overlays.pop(timer_id)
                overlay.close()
                self.config.timer_positions.pop(timer_id, None)

    def _refresh_table(self) -> None:
        states = sorted(self.timer_states.values(), key=lambda item: item.sort_index)
        self.table.setRowCount(len(states))
        for row, state in enumerate(states):
            name_item = QTableWidgetItem(state.name)
            remaining_item = QTableWidgetItem(state.formatted_remaining)
            status_text = "진행 중" if state.is_running else ("완료" if state.remaining_ms == 0 else "대기")
            status_item = QTableWidgetItem(status_text)

            remaining_item.setTextAlignment(Qt.AlignCenter)
            status_item.setTextAlignment(Qt.AlignCenter)

            self.table.setItem(row, 0, name_item)
            self.table.setItem(row, 1, remaining_item)
            self.table.setItem(row, 2, status_item)

    # 상태 업데이트 --------------------------------------------------------
    def _handle_connection_state(self, connected: bool, message: str) -> None:
        self.status_label.setText(message)
        self.status_label.setStyleSheet(
            "color: #4caf50;" if connected else "color: #ff9800;"
        )

    def _on_overlay_moved(self, timer_id: str, x: int, y: int) -> None:
        self.config.timer_positions[timer_id] = (x, y)

    def _capture_positions(self) -> None:
        for timer_id, overlay in self.overlays.items():
            pos = overlay.current_position()
            self.config.timer_positions[timer_id] = (pos.x(), pos.y())

    # 윈도우 수명주기 -------------------------------------------------------
    def closeEvent(self, event):  # type: ignore[override]
        self._capture_positions()
        self.store.save(self.config)
        self.timer_service.stop()
        for overlay in self.overlays.values():
            overlay.close()
        super().closeEvent(event)
