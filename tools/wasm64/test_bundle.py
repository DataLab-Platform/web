"""Small build-only tests; no browser, native scientific packages, or network."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

from artifacts import CACHE, artifact, fingerprint
from build import wheel_archive


class LockedInputs(unittest.TestCase):
    def setUp(self):
        CACHE.mkdir(exist_ok=True)
        scratch = TemporaryDirectory(dir=CACHE)
        self.addCleanup(scratch.cleanup)
        self.mirror = Path(scratch.name)

    def make_wheel(self, name, payload):
        path = self.mirror / f"{name}-1.0-py3-none-any.whl"
        with ZipFile(path, "w") as wheel:
            wheel.writestr(
                f"{name}-1.0.dist-info/WHEEL",
                "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
            )
            for n, data in payload.items():
                wheel.writestr(n, data)
        return dict(
            name=name,
            url="https://files.pythonhosted.org/packages/" + path.name,
            **fingerprint(path),
        )

    def test_corrupt_or_absent_mirror_does_not_fall_back(self):
        rec = self.make_wheel("example", {})
        path = artifact(rec, self.mirror, True)
        with patch(
            "artifacts.download", side_effect=AssertionError("Unexpected download")
        ):
            path.write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "Integrity mismatch"):
                artifact(rec, self.mirror)
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                artifact(rec, self.mirror, True)

    def test_reproducible_and_preserves_resource_bytes(self):
        records = [
            self.make_wheel(
                name, {f"{name}/locale/fr/LC_MESSAGES/{name}.mo": b"\x00\xee"}
            )
            for name in ("sigima", "guidata")
        ]
        a, b = self.mirror / "a.zip", self.mirror / "b.zip"
        wheel_archive(records, a, self.mirror, True)
        wheel_archive(records[::-1], b, self.mirror, True)
        self.assertEqual(fingerprint(a), fingerprint(b))
        with ZipFile(a) as archive:
            self.assertEqual(
                archive.read("sigima/locale/fr/LC_MESSAGES/sigima.mo"), b"\x00\xee"
            )

    def test_rejects_impure_or_overlapping_payloads(self):
        for n in ("extension.pyd", "../external.py"):
            with self.subTest(n=n), self.assertRaises(ValueError):
                wheel_archive(
                    [self.make_wheel("demo", {n: b""})],
                    self.mirror / "bundle.zip",
                    self.mirror,
                    True,
                )
        records = [self.make_wheel(n, {"shared.py": b""}) for n in ("first", "second")]
        with self.assertRaisesRegex(ValueError, "install conflict"):
            wheel_archive(records, self.mirror / "bundle.zip", self.mirror, True)
