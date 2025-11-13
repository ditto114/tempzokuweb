"""애플리케이션 진입점."""
from __future__ import annotations

import logging
import sys

from PyQt5.QtWidgets import QApplication

from .config import ConfigStore
from .main_window import MainWindow

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)


def main() -> None:
    app = QApplication(sys.argv)
    store = ConfigStore()
    window = MainWindow(store)
    window.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
