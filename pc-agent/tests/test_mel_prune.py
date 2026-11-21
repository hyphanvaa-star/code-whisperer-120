"""A new MEL split deletes old VNAxxx.pdf in the PC folder; other files stay."""
import ast
import re
import tempfile
import unittest
from pathlib import Path

source = Path(__file__).parents[1] / "pc_agent.py"
tree = ast.parse(source.read_text(encoding="utf-8"))
picked = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name == "prune_old_mel")
          or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "MEL_NAME" for t in n.targets))]
ns = {"re": re, "Path": Path}
exec(compile(ast.Module(body=picked, type_ignores=[]), str(source), "exec"), ns)


class MelPrune(unittest.TestCase):
    def test_old_mel_removed_new_and_others_kept(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            for n in ["VNA640.pdf", "VNA643.pdf", "vna999.PDF", "notes.pdf", "VNA64.pdf"]:
                (p / n).write_bytes(b"%PDF-")
            removed = ns["prune_old_mel"](p, ["VNA643.pdf"], lambda *_: None)
            self.assertEqual(sorted(removed), ["VNA640.pdf", "vna999.PDF"])
            self.assertEqual(sorted(x.name for x in p.iterdir()), ["VNA64.pdf", "VNA643.pdf", "notes.pdf"])

    def test_shift_clear_removes_only_old_mel(self):
        import os, time
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            now = time.time()
            for n, age_h in [("VNA640.pdf", 10), ("VNA643.pdf", 3), ("VNA650.pdf", 0.5), ("notes.pdf", 10)]:
                (p / n).write_bytes(b"%PDF-")
                os.utime(p / n, (now - age_h * 3600, now - age_h * 3600))
            removed = ns["prune_old_mel"](p, [], lambda *_: None, 2 * 3600, now)
            self.assertEqual(sorted(removed), ["VNA640.pdf", "VNA643.pdf"])
            self.assertEqual(sorted(x.name for x in p.iterdir()), ["VNA650.pdf", "notes.pdf"])


if __name__ == "__main__":
    unittest.main()
