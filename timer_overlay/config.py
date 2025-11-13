"""애플리케이션 설정을 관리하는 모듈."""
from __future__ import annotations

import json
import logging
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

CONFIG_FILE_NAME = "timer_overlay_config.json"


def _default_config_path() -> Path:
    """설정 파일을 저장할 기본 경로를 계산한다."""

    # ``Path.cwd()`` 를 그대로 사용할 경우 Git Bash 같은 환경에서는 ``/c/...`` 처럼
    # Windows 가 이해하지 못하는 경로가 전달될 수 있다. ``resolve()`` 를 거치면
    # 플랫폼에 맞는 절대 경로로 변환되므로, 이후 파일을 생성할 때 실패하지 않는다.
    try:
        working_dir = Path.cwd().resolve()
    except OSError:
        working_dir = None

    # 실행 디렉터리에 쓰기 권한이 없다면(예: 읽기 전용 미디어에서 실행) 패키지 루트
    # 위치로 폴백한다. ``config.py`` 는 ``timer_overlay`` 패키지 바로 아래에 위치하므로
    # 한 단계 상위 폴더가 프로젝트 루트가 된다.
    package_dir = Path(__file__).resolve().parent
    project_root = package_dir.parent

    candidates = []
    if working_dir:
        candidates.append(working_dir)
    candidates.append(project_root)
    candidates.append(package_dir)

    for base in candidates:
        if not base.exists() or not base.is_dir():
            continue

        try:
            # ``os.access`` 는 Windows/MSYS 조합에서 일관적으로 동작하지 않아 실제로
            # 임시 파일을 만들 수 있는지 확인하여 쓰기 가능 여부를 판단한다.
            with tempfile.NamedTemporaryFile(dir=base, delete=True):
                pass
        except (OSError, PermissionError):
            logger.debug("설정 경로 후보 %s 는 쓰기 불가", base)
            continue

        return base / CONFIG_FILE_NAME

    # 모든 후보가 실패할 경우 마지막 수단으로 사용자 홈 디렉터리를 사용한다.
    return Path.home() / CONFIG_FILE_NAME


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


class ConfigStore:
    """설정 파일을 로드/저장하기 위한 헬퍼 클래스."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _default_config_path()
        self._lock = threading.Lock()
        logger.debug("설정 파일 경로: %s", self._path)

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> AppConfig:
        with self._lock:
            if not self._path.exists():
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
                self.save(default)
                return default

            with self._path.open("r", encoding="utf-8") as fp:
                data = json.load(fp)
            return AppConfig.from_dict(data)

    def save(self, config: AppConfig) -> None:
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with self._path.open("w", encoding="utf-8") as fp:
                json.dump(config.to_dict(), fp, indent=2, ensure_ascii=False)
