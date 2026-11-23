"""ATC+EZFW draft keeps the web-built OMC signature and inline banner."""
import ast
import base64
import os
import re
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).parents[1] / "pc_agent.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "do_owa_draft")


def run(payload):
    seen = {}

    def create_draft(token, **kw):
        seen.update(kw)
        seen["inline_bytes"] = {k: Path(v).read_bytes() for k, v in (kw.get("inline") or {}).items()}
        return "draft-1"

    owa = SimpleNamespace(ensure_fresh_token=lambda **_: "tok", create_draft=create_draft)
    ns = {"base64": base64, "re": re, "os": os, "Path": Path,
          "_load_owa_modules": lambda: (SimpleNamespace(), owa),
          "_NoCancel": lambda: None}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(SOURCE), "exec"), ns)
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["TEMP"] = tmp
        ns["do_owa_draft"](payload, lambda _m: None)
    return seen


class DraftSignature(unittest.TestCase):
    def test_html_body_and_inline_banner_are_sent(self):
        seen = run({"subject": "S", "body": "Dear On Duty,", "html": "<b>OPERATION MANAGEMENT CENTER</b>",
                    "inline": [{"cid": "omc_signature_banner", "name": "omc.jpg",
                                "data_b64": base64.b64encode(b"JPG").decode()}]})
        self.assertTrue(seen["html"])
        self.assertIn("OPERATION MANAGEMENT CENTER", seen["body"])
        self.assertEqual(seen["inline_bytes"], {"omc_signature_banner": b"JPG"})

    def test_text_only_payload_stays_plain(self):
        seen = run({"subject": "S", "body": "Dear On Duty,"})
        self.assertFalse(seen["html"])
        self.assertEqual(seen["body"], "Dear On Duty,")
        self.assertIsNone(seen["inline"])


if __name__ == "__main__":
    unittest.main()
