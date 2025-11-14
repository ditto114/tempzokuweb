"""애플리케이션 진입점."""
from __future__ import annotations

import logging
import sys

from PyQt5.QtWidgets import QApplication

from timer_overlay.config import ConfigStore
from timer_overlay.main_window import MainWindow

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)


def main() -> None:
    app = QApplication(sys.argv)
    store = ConfigStore()
    window = MainWindow(store)
    window.show()
    window.raise_()
    window.activateWindow()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
