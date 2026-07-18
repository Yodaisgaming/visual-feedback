#!/usr/bin/env python3
"""Path-resolution tests for scripts/feedback_inbox.py (_resolve traversal guard)."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import feedback_inbox


class ResolveTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_inbox = feedback_inbox.INBOX
        feedback_inbox.INBOX = Path(self._tmp.name)
        self.batch = feedback_inbox.INBOX / "vfb-test.json"
        self.batch.write_text("{}", encoding="utf-8")

    def tearDown(self):
        feedback_inbox.INBOX = self._orig_inbox
        self._tmp.cleanup()

    def test_resolves_plain_name(self):
        self.assertEqual(feedback_inbox._resolve("vfb-test.json"), self.batch.resolve())

    def test_resolves_inbox_prefixed_name(self):
        self.assertEqual(feedback_inbox._resolve("visual-feedback/vfb-test.json"), self.batch.resolve())

    def test_rejects_absolute_path(self):
        with self.assertRaises(SystemExit):
            feedback_inbox._resolve("/etc/passwd")

    def test_rejects_parent_traversal(self):
        outside = Path(self._tmp.name).parent / "escape.json"
        outside.write_text("{}", encoding="utf-8")
        try:
            with self.assertRaises(SystemExit):
                feedback_inbox._resolve("../escape.json")
        finally:
            outside.unlink()

    def test_rejects_missing_file(self):
        with self.assertRaises(SystemExit):
            feedback_inbox._resolve("vfb-nope.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)
