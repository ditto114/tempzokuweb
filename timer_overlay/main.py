"""타이머 오버레이 진입점."""
import logging
import sys

from PyQt5.QtWidgets import QApplication

from timer_overlay.app import TimerOverlayApp
from timer_overlay.config import ConfigStore


def main():
    """애플리케이션 시작."""
    # 로깅 설정
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s %(name)s: %(message)s"
    )
    
    # Qt 애플리케이션
    app = QApplication(sys.argv)
    app.setApplicationName("타이머 오버레이")
    
    # 설정 로드
    config_store = ConfigStore()
    
    # 메인 윈도우
    window = TimerOverlayApp(config_store)
    window.show()
    
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
