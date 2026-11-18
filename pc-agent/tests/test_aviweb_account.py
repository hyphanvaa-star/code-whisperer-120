"""AviWeb account handed down by the web must win over the PC's local file."""
import ast
import os
from pathlib import Path
import unittest

SOURCE = Path(__file__).parents[1] / "pc_agent.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
node = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "_AviwebAccount")


def load():
    ns = {"os": os}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(SOURCE), "exec"), ns)
    return ns["_AviwebAccount"]


class AviwebAccountTests(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.get(k) for k in ("AVIWEB_USER", "AVIWEB_PASS")}
        os.environ["AVIWEB_USER"] = "omc@vietjetair.com"
        os.environ["AVIWEB_PASS"] = "old"

    def tearDown(self):
        for k, v in self.saved.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

    def test_web_account_is_used_during_submit(self):
        lines = []
        with load()({"aviweb_user": "omc1@vnaic.vn", "aviweb_pass": "new"}, lambda *a: lines.append(a[0])):
            self.assertEqual(os.environ["AVIWEB_USER"], "omc1@vnaic.vn")
            self.assertEqual(os.environ["AVIWEB_PASS"], "new")
        self.assertIn("omc1@vnaic.vn", lines[0])
        self.assertNotIn("new", lines[0].split("(")[0].replace("omc1@vnaic.vn", ""))

    def test_previous_env_is_restored_after_submit(self):
        with load()({"aviweb_user": "omc1@vnaic.vn", "aviweb_pass": "new"}, lambda *a: None):
            pass
        self.assertEqual(os.environ["AVIWEB_USER"], "omc@vietjetair.com")
        self.assertEqual(os.environ["AVIWEB_PASS"], "old")

    def test_missing_web_account_falls_back_to_local_file(self):
        with load()({}, lambda *a: None):
            self.assertNotIn("AVIWEB_USER", os.environ)
            self.assertNotIn("AVIWEB_PASS", os.environ)


if __name__ == "__main__":
    unittest.main()
