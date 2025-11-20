"""애플리케이션 설정을 관리하는 모듈."""
from __future__ import annotations

import json
import logging
import os
import platform
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Tuple

logger = logging.getLogger(__name__)

CONFIG_FILE_NAME = "timer_overlay_config.json"
CONFIG_ENV_VAR = "TIMER_OVERLAY_CONFIG_PATH"


def _env_override_path() -> Path | None:
    """환경 변수로 지정된 설정 파일 경로를 반환한다."""

    raw_path = os.getenv(CONFIG_ENV_VAR)
    if not raw_path:
        return None

    path = Path(raw_path).expanduser()
    if path.exists() and path.is_dir():
        return path / CONFIG_FILE_NAME
    if raw_path.endswith(("/", "\\")):
        return path / CONFIG_FILE_NAME
    return path


def _is_writable_directory(path: Path) -> bool:
    """디렉터리가 존재하며 쓰기 가능한지 확인한다."""

    try:
        path.mkdir(parents=True, exist_ok=True)
    except (OSError, PermissionError):
        return False

    if not path.exists() or not path.is_dir():
        return False

    try:
        with tempfile.NamedTemporaryFile(dir=path, delete=True):
            pass
    except (OSError, PermissionError):
        return False
    return True


def _default_config_path() -> Path:
    """설정 파일을 저장할 기본 경로를 계산한다."""

    try:
        working_dir = Path.cwd().resolve()
    except OSError:
        working_dir = None

    package_dir = Path(__file__).resolve().parent
    project_root = package_dir.parent

    candidates: list[Path] = []
    if working_dir:
        candidates.append(working_dir)

    if platform.system() == "Windows":
        appdata = os.getenv("APPDATA")
        local_appdata = os.getenv("LOCALAPPDATA")
        for base in (appdata, local_appdata):
            if base:
                candidates.append(Path(base) / "TimerOverlay")

    candidates.append(project_root)
    candidates.append(package_dir)

    for base in candidates:
        if _is_writable_directory(base):
            return base / CONFIG_FILE_NAME
        logger.debug("설정 경로 후보 %s 는 쓰기 불가", base)

    home_dir = Path.home()
    if not _is_writable_directory(home_dir):
        raise PermissionError("설정을 저장할 수 있는 디렉터리를 찾지 못했습니다.")
    return home_dir / CONFIG_FILE_NAME


def _parse_position(raw: Iterable[int | float]) -> Tuple[int, int] | None:
    try:
        x, y = list(raw)[:2]
        return int(x), int(y)
    except (TypeError, ValueError):
        return None


@dataclass
class AppConfig:
    """애플리케이션 전역 설정."""

    server_host: str = "218.234.230.188"
    server_port: int = 47984
    channel_code: str = ""
    timer_positions: Dict[str, Tuple[int, int]] = field(default_factory=dict)
    timer_hotkeys: Dict[str, str] = field(default_factory=dict)
    overlay_opacity: int = 85
    overlay_scale: int = 1

    @classmethod
    def from_dict(cls, data: Dict) -> "AppConfig":
        timer_positions: Dict[str, Tuple[int, int]] = {}

        if isinstance(data.get("timer_positions"), dict):
            for timer_id, raw_position in data["timer_positions"].items():
                parsed = _parse_position(raw_position)
                if parsed is not None:
                    timer_positions[str(timer_id)] = parsed

        # 레거시 형식 지원: timers 리스트에 위치 정보가 포함되어 있는 경우
        elif isinstance(data.get("timers"), list):
            for item in data["timers"]:
                timer_id = item.get("id")
                if not timer_id:
                    continue
                parsed = _parse_position(item.get("position", (100, 100)))
                if parsed is not None:
                    timer_positions[str(timer_id)] = parsed

        hotkeys: Dict[str, str] = {}
        raw_hotkeys = data.get("timer_hotkeys")
        if isinstance(raw_hotkeys, dict):
            for timer_id, value in raw_hotkeys.items():
                if not isinstance(value, str):
                    continue
                key_name = value.strip().lower()
                if not key_name:
                    continue
                hotkeys[str(timer_id)] = key_name

        return cls(
            server_host=data.get("server_host", "218.234.230.188"),
            server_port=int(data.get("server_port", 47984)),
            timer_positions=timer_positions,
            overlay_opacity=int(data.get("overlay_opacity", 85)),
            timer_hotkeys=hotkeys,
            overlay_scale=int(data.get("overlay_scale", 1)),
            channel_code=str(data.get("channel_code", "")).strip(),
        )

    def to_dict(self) -> Dict:
        return {
            "server_host": self.server_host,
            "server_port": self.server_port,
            "channel_code": self.channel_code,
            "timer_positions": {key: list(value) for key, value in self.timer_positions.items()},
            "overlay_opacity": int(self.overlay_opacity),
            "timer_hotkeys": dict(self.timer_hotkeys),
            "overlay_scale": int(self.overlay_scale),
        }


def _ensure_writable_file_path(path: Path) -> Path:
    """파일을 저장할 수 있는 경로를 보장한다."""

    target = path.expanduser()
    if target.is_dir():
        target = target / CONFIG_FILE_NAME

    parent = target.parent
    if not _is_writable_directory(parent):
        logger.warning("설정 파일 경로 %s 에 쓸 수 없습니다. 사용자 홈으로 폴백합니다.", parent)
        home_dir = Path.home()
        if not _is_writable_directory(home_dir):
            raise PermissionError("설정을 저장할 수 있는 디렉터리를 찾지 못했습니다.")
        target = home_dir / CONFIG_FILE_NAME

    return target


class ConfigStore:
    """설정 파일을 로드/저장하기 위한 헬퍼 클래스."""

    def __init__(self, path: Path | None = None) -> None:
        if path is not None:
            resolved = path
        else:
            resolved = _env_override_path() or _default_config_path()

        self._path = _ensure_writable_file_path(resolved)
        self._lock = threading.Lock()
        logger.info("설정 파일 경로: %s", self._path)
        # 초기 실행 시점에 설정 파일이 실제로 존재하도록 보장한다.
        with self._lock:
            self._load_or_initialize_locked()

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> AppConfig:
        with self._lock:
            return self._load_or_initialize_locked()

    def save(self, config: AppConfig) -> None:
        with self._lock:
            self._write_config_locked(config)

    def _load_or_initialize_locked(self) -> AppConfig:
        if not self._path.exists():
            default = self._create_default_config()
            self._write_config_locked(default)
            return default

        try:
            with self._path.open("r", encoding="utf-8") as fp:
                data = json.load(fp)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("설정 파일을 읽을 수 없어 초기화합니다: %s", exc)
            default = self._create_default_config()
            self._write_config_locked(default)
            return default

        return AppConfig.from_dict(data)

    def _write_config_locked(self, config: AppConfig) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("w", encoding="utf-8") as fp:
            json.dump(config.to_dict(), fp, indent=2, ensure_ascii=False)

    @staticmethod
    def _create_default_config() -> AppConfig:
        return AppConfig()
