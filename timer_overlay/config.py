"""애플리케이션 설정을 관리하는 모듈."""
from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

CONFIG_FILE_NAME = "timer_overlay_config.json"


def _default_config_path() -> Path:
    """사용자 홈 디렉터리에 위치한 설정 파일 경로를 반환한다."""
    # Windows 의 Git Bash 와 같이 ``HOME=/c/Users/foo`` 형태로 설정된 환경에서는
    # ``Path.home()`` 이 ``/c/Users/foo`` (즉 ``C:\\c\\Users\\foo``) 를 반환한다. 이
    # 경로는 실제 사용자 홈 디렉터리가 아니므로 설정 파일이 예상치 못한 곳에
    # 생성되거나, 아예 저장에 실패한다. 이를 방지하기 위해 ``Path.home()`` 가 가리키는
    # 경로가 존재하지 않을 경우 Windows 전용 환경 변수 ``USERPROFILE`` 혹은
    # ``HOMEDRIVE``/``HOMEPATH`` 를 활용해 올바른 홈 경로를 재계산한다.
    home = Path.home()

    if not home.exists() and os.name == "nt":
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            candidate = Path(user_profile)
            if candidate.exists():
                home = candidate
        else:
            drive = os.environ.get("HOMEDRIVE")
            path = os.environ.get("HOMEPATH")
            if drive and path:
                candidate = Path(drive + path)
                if candidate.exists():
                    home = candidate

    return home / CONFIG_FILE_NAME


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
