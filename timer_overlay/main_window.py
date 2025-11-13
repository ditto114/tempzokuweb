"""메인 윈도우 구현."""
from __future__ import annotations

import logging
import uuid
from typing import Dict, Optional

from PyQt5.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QKeySequenceEdit,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from .config import AppConfig, ConfigStore, TimerConfig
from .hotkey_manager import HotkeyManager
from .network import ServerClient, ServerSettings
from .overlay_widget import TimerOverlayWidget
from .timer import TimerCallbacks, TimerController
from .utils import hotkey_to_display_text, qkeysequence_to_hotkey

logger = logging.getLogger(__name__)


class TimerEditDialog(QDialog):
    """타이머 생성/수정 다이얼로그."""

    def __init__(self, parent: QWidget | None = None, config: Optional[TimerConfig] = None):
        super().__init__(parent)
        self.setWindowTitle("타이머 설정")
        self._config = config
        self._result_config: Optional[TimerConfig] = None

        self.name_edit = QLineEdit()
        self.duration_spin = QSpinBox()
        self.duration_spin.setRange(1, 24 * 60 * 60)
        self.duration_spin.setSuffix(" 초")
        self.start_hotkey_edit = QKeySequenceEdit()
        self.reset_hotkey_edit = QKeySequenceEdit()

        if config:
            self.name_edit.setText(config.name)
            self.duration_spin.setValue(config.duration_seconds)
            self.start_hotkey_edit.setKeySequence(hotkey_to_display_text(config.start_hotkey))
            self.reset_hotkey_edit.setKeySequence(hotkey_to_display_text(config.reset_hotkey))

        form = QFormLayout()
        form.addRow("이름", self.name_edit)
        form.addRow("지속 시간", self.duration_spin)
        form.addRow("시작 단축키", self.start_hotkey_edit)
        form.addRow("리셋 단축키", self.reset_hotkey_edit)

        button_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        button_box.accepted.connect(self.accept)
        button_box.rejected.connect(self.reject)

        layout = QVBoxLayout()
        layout.addLayout(form)
        layout.addWidget(button_box)
        self.setLayout(layout)

    def get_config(self) -> Optional[TimerConfig]:
        if self.exec_() != QDialog.Accepted:
            return None
        return self._result_config

    def accept(self) -> None:
        name = self.name_edit.text().strip() or "Timer"
        duration = self.duration_spin.value()
        start_seq = self.start_hotkey_edit.keySequence()
        reset_seq = self.reset_hotkey_edit.keySequence()
        start_hotkey = qkeysequence_to_hotkey(start_seq)
        reset_hotkey = qkeysequence_to_hotkey(reset_seq)
        if not start_hotkey or not reset_hotkey:
            QMessageBox.warning(self, "단축키", "단축키를 모두 입력해주세요.")
            return
        timer_id = self._config.id if self._config else str(uuid.uuid4())
        position = self._config.position if self._config else (100, 100)
        self._result_config = TimerConfig(
            id=timer_id,
            name=name,
            duration_seconds=duration,
            start_hotkey=start_hotkey,
            reset_hotkey=reset_hotkey,
            position=position,
        )
        super().accept()


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
        self.setWindowTitle("멀티 타이머 오버레이")
        self.resize(640, 400)

        self.store = store
        self.config = store.load()
        self.server_client = ServerClient(
            ServerSettings(self.config.server_host, self.config.server_port)
        )
        self.server_client.start()

        self.hotkeys = HotkeyManager()
        self.hotkeys.start()

        self.timer_controllers: Dict[str, TimerController] = {}
        self.overlays: Dict[str, TimerOverlayWidget] = {}

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["이름", "지속 시간(초)", "시작", "리셋"])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)

        add_btn = QPushButton("추가")
        edit_btn = QPushButton("편집")
        remove_btn = QPushButton("삭제")
        server_btn = QPushButton("서버 설정")
        save_btn = QPushButton("저장")

        add_btn.clicked.connect(self._add_timer)
        edit_btn.clicked.connect(self._edit_timer)
        remove_btn.clicked.connect(self._remove_timer)
        server_btn.clicked.connect(self._edit_server_settings)
        save_btn.clicked.connect(self._save_and_apply)

        button_row = QHBoxLayout()
        button_row.addWidget(add_btn)
        button_row.addWidget(edit_btn)
        button_row.addWidget(remove_btn)
        button_row.addStretch(1)
        button_row.addWidget(server_btn)
        button_row.addWidget(save_btn)

        layout = QVBoxLayout()
        layout.addWidget(self.table)
        layout.addLayout(button_row)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        self._load_timers()

    def _load_timers(self) -> None:
        self.table.setRowCount(0)
        self.timer_controllers.clear()
        self.overlays.clear()
        self.hotkeys.clear()

        for timer_config in self.config.timers:
            self._create_timer(timer_config)

    def _create_timer(self, timer_config: TimerConfig) -> None:
        callbacks = TimerCallbacks(
            on_started=lambda ctrl, timer_id=timer_config.id: self._on_timer_started(timer_id, ctrl),
            on_reset=lambda ctrl, timer_id=timer_config.id: self._on_timer_reset(timer_id, ctrl),
            on_tick=lambda ctrl, timer_id=timer_config.id: self._on_timer_tick(timer_id, ctrl),
            on_completed=lambda ctrl, timer_id=timer_config.id: self._on_timer_completed(timer_id, ctrl),
        )
        controller = TimerController(timer_config, callbacks)
        overlay = TimerOverlayWidget(controller)
        overlay.position_changed.connect(
            lambda x, y, timer_id=timer_config.id: self._update_timer_position(timer_id, x, y)
        )
        overlay.update_position(*timer_config.position)
        overlay.show()

        self.timer_controllers[timer_config.id] = controller
        self.overlays[timer_config.id] = overlay

        self._register_hotkeys(timer_config, controller)
        self._append_timer_to_table(timer_config)

    def _register_hotkeys(self, config: TimerConfig, controller: TimerController) -> None:
        self.hotkeys.register(
            f"{config.id}:start", config.start_hotkey, lambda ctrl=controller: ctrl.start()
        )
        self.hotkeys.register(
            f"{config.id}:reset", config.reset_hotkey, lambda ctrl=controller: ctrl.reset()
        )

    def _append_timer_to_table(self, config: TimerConfig) -> None:
        row = self.table.rowCount()
        self.table.insertRow(row)
        self.table.setItem(row, 0, QTableWidgetItem(config.name))
        self.table.setItem(row, 1, QTableWidgetItem(str(config.duration_seconds)))
        self.table.setItem(row, 2, QTableWidgetItem(hotkey_to_display_text(config.start_hotkey)))
        self.table.setItem(row, 3, QTableWidgetItem(hotkey_to_display_text(config.reset_hotkey)))
        self.table.setRowHeight(row, 30)

    def _find_selected_timer(self) -> Optional[TimerConfig]:
        selected = self.table.currentRow()
        if selected < 0 or selected >= len(self.config.timers):
            return None
        return self.config.timers[selected]

    def _add_timer(self) -> None:
        dialog = TimerEditDialog(self)
        new_config = dialog.get_config()
        if not new_config:
            return
        self.config.timers.append(new_config)
        self._create_timer(new_config)

    def _edit_timer(self) -> None:
        config = self._find_selected_timer()
        if not config:
            return
        dialog = TimerEditDialog(self, config)
        updated = dialog.get_config()
        if not updated:
            return
        index = self.config.timers.index(config)
        self.config.timers[index] = updated
        self._reload_all()

    def _remove_timer(self) -> None:
        config = self._find_selected_timer()
        if not config:
            return
        confirm = QMessageBox.question(
            self,
            "삭제",
            f"'{config.name}' 타이머를 삭제하시겠습니까?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if confirm != QMessageBox.Yes:
            return
        self.config.timers.remove(config)
        self._reload_all()

    def _reload_all(self) -> None:
        for overlay in self.overlays.values():
            overlay.close()
        self._load_timers()

    def _edit_server_settings(self) -> None:
        dialog = ServerSettingsDialog(self, self.config)
        if dialog.apply(self.config):
            self.server_client.update_settings(
                ServerSettings(self.config.server_host, self.config.server_port)
            )
            QMessageBox.information(self, "서버", "서버 설정이 업데이트되었습니다.")

    def _save_and_apply(self) -> None:
        self._capture_positions()
        self.store.save(self.config)
        QMessageBox.information(self, "저장", "설정이 저장되었습니다.")

    def _capture_positions(self) -> None:
        for config in self.config.timers:
            overlay = self.overlays.get(config.id)
            if overlay:
                pos = overlay.current_position()
                config.position = (pos.x(), pos.y())

    def _update_timer_position(self, timer_id: str, x: int, y: int) -> None:
        config = next((t for t in self.config.timers if t.id == timer_id), None)
        if config:
            config.position = (x, y)

    def closeEvent(self, event):  # type: ignore[override]
        self._capture_positions()
        self.store.save(self.config)
        self.hotkeys.stop()
        self.server_client.stop()
        for overlay in self.overlays.values():
            overlay.close()
        super().closeEvent(event)

    # 타이머 이벤트 콜백 --------------------------------------------------
    def _on_timer_started(self, timer_id: str, controller: TimerController) -> None:
        logger.info("타이머 시작: %s", timer_id)
        self.server_client.send_event(
            "timer_started",
            {
                "timer_id": timer_id,
                "remaining": controller.remaining_seconds,
            },
        )

    def _on_timer_reset(self, timer_id: str, controller: TimerController) -> None:
        logger.info("타이머 리셋: %s", timer_id)
        self.server_client.send_event(
            "timer_reset",
            {"timer_id": timer_id, "remaining": controller.remaining_seconds},
        )

    def _on_timer_tick(self, timer_id: str, controller: TimerController) -> None:
        self.server_client.send_event(
            "timer_tick", {"timer_id": timer_id, "remaining": controller.remaining_seconds}
        )

    def _on_timer_completed(self, timer_id: str, controller: TimerController) -> None:
        logger.info("타이머 완료: %s", timer_id)
        self.server_client.send_event(
            "timer_completed",
            {"timer_id": timer_id},
        )
