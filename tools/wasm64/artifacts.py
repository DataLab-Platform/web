"""Shared file and integrity checks. Never resolve dependencies here."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PYJS = HERE / "node_modules/@derthorsten/pyjs"
CACHE = HERE / ".cache"
MIRROR = CACHE / "mirror"
TARGET = "emscripten-wasm64"
EF = "https://repo.prefix.dev/emscripten-forge/6x"
CF = "https://conda.anaconda.org/conda-forge"


def check(condition, message):
    if not condition:
        raise ValueError(message)


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf8", newline="\n")


def fingerprint(path):
    with path.open("rb") as f:
        return dict(
            size=path.stat().st_size,
            sha256=hashlib.file_digest(f, "sha256").hexdigest(),
        )


def download(url, path, limit):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-time",
            "120",
            "--max-filesize",
            str(limit),
            "--output",
            str(path),
            url,
        ],
        check=True,
    )
    check(path.stat().st_size <= limit, f"Size limit exceeded: {url}")


def artifact(rec, mirror=MIRROR, offline=False):
    url = rec["url"]
    name = urlsplit(url).path.rsplit("/", 1)[-1]
    check(re.fullmatch(r"[a-zA-Z0-9_.+-]+", name) and name not in (".", ".."), url)
    check(
        re.fullmatch(r"[a-f0-9]{64}", rec["sha256"]) and 0 < rec["size"] < 64 << 20, url
    )
    check(
        url.startswith(
            (
                EF + "/" + TARGET + "/",
                EF + "/noarch/",
                CF + "/noarch/",
                "https://files.pythonhosted.org/packages/",
            )
        ),
        f"Unexpected origin: {url}",
    )
    path = mirror / name
    if not path.is_file():
        if offline:
            raise FileNotFoundError(path)
        part = path.with_suffix(path.suffix + ".part")
        try:
            download(url, part, rec["size"])
            verify(part, rec)
            part.replace(path)
        finally:
            part.unlink(missing_ok=True)
    verify(path, rec)
    return path


def verify(path, rec):
    check(
        fingerprint(path) == {k: rec[k] for k in ("size", "sha256")},
        f"Integrity mismatch: {path}",
    )
