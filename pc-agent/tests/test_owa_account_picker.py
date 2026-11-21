"""Outlook 'Pick an account': pick the saved email, else 'Use another account'."""
import ast
from pathlib import Path
import unittest

SOURCE = Path(__file__).parents[1] / "tool" / "outlook_web_pib.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
nodes = [n for n in tree.body if (
    isinstance(n, ast.FunctionDef) and n.name == "_pick_account_choice"
) or (isinstance(n, ast.Assign) and any(
    isinstance(t, ast.Name) and t.id in ("_OTHER_ACCOUNT", "_PICKER_MARKERS") for t in n.targets
))]
ns: dict = {}
exec(compile(ast.fix_missing_locations(ast.Module(
    body=ast.parse("from __future__ import annotations").body + nodes, type_ignores=[])), str(SOURCE), "exec"), ns)
pick = ns["_pick_account_choice"]
PICKER = "Microsoft\nPick an account\nthanhdohuu@vietjetair.com\nUse another account"


class PickerTests(unittest.TestCase):
    def test_other_users_tile_only_clicks_use_another_account(self):
        texts = ["Pick an account\nthanhdohuu@vietjetair.com\nUse another account",
                 "thanhdohuu@vietjetair.com", "Use another account"]
        self.assertEqual(pick(texts, "hienphamduc@vietjetair.com", PICKER), ("other", 2))

    def test_saved_account_tile_is_clicked(self):
        texts = ["Pick an account\nHienPhamDuc@vietjetair.com\nUse another account",
                 "HienPhamDuc@vietjetair.com\nSigned in", "Use another account"]
        self.assertEqual(pick(texts, "hienphamduc@vietjetair.com", PICKER), ("match", 1))

    def test_password_page_email_banner_is_never_clicked(self):
        texts = ["hienphamduc@vietjetair.com", "Forgot my password", "Sign in with another account"]
        self.assertIsNone(pick(texts, "hienphamduc@vietjetair.com",
                               "hienphamduc@vietjetair.com\nEnter password"))

    def test_no_saved_username_does_nothing(self):
        self.assertIsNone(pick(["Use another account"], "", PICKER))


if __name__ == "__main__":
    unittest.main()
