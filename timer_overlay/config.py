"""애플리케이션 설정을 관리하는 모듈."""
from __future__ import annotations

import json
import logging
import os
import platform
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

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

    # ``Path.cwd()`` 를 그대로 사용할 경우 Git Bash 같은 환경에서는 ``/c/...`` 처럼
    # Windows 가 이해하지 못하는 경로가 전달될 수 있다. ``resolve()`` 를 거치면
    # 플랫폼에 맞는 절대 경로로 변환되므로, 이후 파일을 생성할 때 실패하지 않는다.
    try:
        working_dir = Path.cwd().resolve()
    except OSError:
        working_dir = None

    package_dir = Path(__file__).resolve().parent
    project_root = package_dir.parent

    candidates: List[Path] = []
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

    # 모든 후보가 실패할 경우 마지막 수단으로 사용자 홈 디렉터리를 사용한다.
    home_dir = Path.home()
    if not _is_writable_directory(home_dir):
        raise PermissionError("설정을 저장할 수 있는 디렉터리를 찾지 못했습니다.")
    return home_dir / CONFIG_FILE_NAME


@dataclass
class TimerConfig:
    """단일 타이머에 대한 설정."""

    id: str
    name: str
    duration_seconds: int
    start_hotkey: str
    reset_hotkey: str
    position: Tuple[int, int] = (100, 100)

    @classmethod
    def from_dict(cls, data: Dict) -> "TimerConfig":
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            name=data.get("name", "Timer"),
            duration_seconds=int(data.get("duration_seconds", 60)),
            start_hotkey=data.get("start_hotkey", "<ctrl>+<alt>+1"),
            reset_hotkey=data.get("reset_hotkey", "<ctrl>+<alt>+<shift>+1"),
            position=tuple(data.get("position", (100, 100))),
        )

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "name": self.name,
            "duration_seconds": self.duration_seconds,
            "start_hotkey": self.start_hotkey,
            "reset_hotkey": self.reset_hotkey,
            "position": list(self.position),
        }


@dataclass
class AppConfig:
    """애플리케이션 전역 설정."""

    server_host: str = "localhost"
    server_port: int = 8000
    timers: List[TimerConfig] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict) -> "AppConfig":
        timers = [TimerConfig.from_dict(item) for item in data.get("timers", [])]
        return cls(
            server_host=data.get("server_host", "localhost"),
            server_port=int(data.get("server_port", 8000)),
            timers=timers,
        )

    def to_dict(self) -> Dict:
        return {
            "server_host": self.server_host,
            "server_port": self.server_port,
            "timers": [timer.to_dict() for timer in self.timers],
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

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> AppConfig:
        with self._lock:
            if not self._path.exists():
                default = self._create_default_config()
                self.save(default)
                return default

            try:
                with self._path.open("r", encoding="utf-8") as fp:
                    data = json.load(fp)
            except json.JSONDecodeError as exc:
                logger.warning("설정 파일을 읽을 수 없어 초기화합니다: %s", exc)
                default = self._create_default_config()
                self.save(default)
                return default
            return AppConfig.from_dict(data)

    def save(self, config: AppConfig) -> None:
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with self._path.open("w", encoding="utf-8") as fp:
                json.dump(config.to_dict(), fp, indent=2, ensure_ascii=False)

    @staticmethod
    def _create_default_config() -> AppConfig:
        default = AppConfig()
        default.timers.append(
            TimerConfig(
                id=str(uuid.uuid4()),
                name="Timer 1",
                duration_seconds=300,
                start_hotkey="<ctrl>+<alt>+1",
                reset_hotkey="<ctrl>+<alt>+<shift>+1",
            )
        )
        return default
