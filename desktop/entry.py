import os
from pathlib import Path
from urllib.parse import urlparse

from granian import Granian
from migrate import check_and_run_migrations


def main() -> None:
    os.environ.setdefault("DESKTOP_MODE", "true")
    os.chdir(Path(__file__).resolve().parent)
    check_and_run_migrations()

    base_url = os.environ.get("BASE_URL", "http://127.0.0.1:8081")
    parsed = urlparse(base_url)
    port = parsed.port or 8081

    server = Granian(
        target="app.main:app",
        address="127.0.0.1",
        port=port,
        interface="asgi",
        workers=1,
    )
    server.serve()


if __name__ == "__main__":
    main()
