"""Regression coverage for the opt-in, single-artifact exception."""

from __future__ import annotations

import unittest

from kiwi_workaround import KIWI_SHA256, distribution_version


class KiwiVersionTest(unittest.TestCase):
    def test_only_the_reviewed_artifact_is_eligible(self):
        record = dict(
            name="kiwisolver",
            version="1.5.1",
            build="py314hd0a4d62_0",
            subdir="emscripten-wasm64",
            sha256=KIWI_SHA256,
        )
        with self.assertWarnsRegex(UserWarning, "web#139"):
            self.assertEqual(
                distribution_version(record, "kiwisolver", "0.0.0", True), "1.5.1"
            )
        for changes, name, enabled in [
            ({}, "kiwisolver", False),
            ({"sha256": "0" * 64}, "kiwisolver", True),
            ({"subdir": "emscripten-wasm32"}, "kiwisolver", True),
            ({}, "other", True),
        ]:
            with self.subTest(changes=changes, name=name, enabled=enabled):
                self.assertEqual(
                    distribution_version(record | changes, name, "0.0.0", enabled),
                    "0.0.0",
                )
        self.assertEqual(
            distribution_version(record, "kiwisolver", "1.5.2", True), "1.5.2"
        )
