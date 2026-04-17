"""Idempotent HTTP server for the Python coverage HTML report.

Binds ``http://127.0.0.1:8765/`` to ``htmlcov-python/`` so VS Code's
Simple Browser (which only accepts ``http(s)://`` URLs, not ``file://``)
can display the report inside an editor tab.

If port 8765 is already in use we assume a previous instance is still
serving the same directory, print ``READY`` and exit 0 so the calling
VS Code task immediately proceeds to opening the browser.
"""

from __future__ import annotations

import http.server
import os
import socket
import socketserver
import sys
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8765
DIRECTORY = "htmlcov-python"


def _port_in_use(host: str, port: int) -> bool:
    """Return True if *host:port* already has a listening socket."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        try:
            sock.connect((host, port))
        except OSError:
            return False
    return True


def main() -> int:
    """Serve ``htmlcov-python`` on http://127.0.0.1:8765/ in the foreground."""
    root = Path(__file__).resolve().parent.parent / DIRECTORY
    if not root.is_dir():
        print(f"ERROR: coverage report not found at {root}", file=sys.stderr)
        return 1

    if _port_in_use(HOST, PORT):
        print(f"READY (port {PORT} already in use \u2014 reusing existing server)")
        return 0

    os.chdir(root)
    handler = http.server.SimpleHTTPRequestHandler
    # ``allow_reuse_address`` shortens the TIME_WAIT window when the
    # task is restarted from VS Code.
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((HOST, PORT), handler) as httpd:
        print(f"READY http://{HOST}:{PORT}/ (serving {root})")
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
