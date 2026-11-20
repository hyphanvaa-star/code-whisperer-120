"""Machine id is stable per PC and handed to the browser, so jobs land on the PC that asked."""
import ast
from pathlib import Path
import socket
import unittest

SOURCE = Path(__file__).parents[1] / "pc_agent.py"
TEXT = SOURCE.read_text(encoding="utf-8")
tree = ast.parse(TEXT)
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_machine_id")


def load():
    ns = {"socket": socket}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(SOURCE), "exec"), ns)
    return ns["_machine_id"]


class MachineIdTests(unittest.TestCase):
    def test_stable_hex_id(self):
        f = load()
        a, b = f(), f()
        self.assertEqual(a, b)
        self.assertRegex(a, r"^[0-9a-f]{24}$")

    def test_sent_on_pair_and_poll(self):
        self.assertIn('"aid": AGENT_ID}).encode()', TEXT)
        self.assertIn('"aid": AGENT_ID,', TEXT)


if __name__ == "__main__":
    unittest.main()
