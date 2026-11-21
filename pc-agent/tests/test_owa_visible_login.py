"""Outlook login: Chrome hidden first, visible window only when login/MFA is required."""
import ast
from pathlib import Path
import unittest

SOURCE = Path(__file__).parents[1] / "tool" / "outlook_web_pib.py"
TEXT = SOURCE.read_text(encoding="utf-8")
tree = ast.parse(TEXT)
nodes = [n for n in tree.body if (
    isinstance(n, ast.FunctionDef) and n.name == "_should_show_login"
) or (isinstance(n, ast.Assign) and any(
    isinstance(t, ast.Name) and t.id in ("_HEADLESS_LOGIN_GRACE_S", "_MFA_MARKERS") for t in n.targets
))]
ns: dict = {}
exec(compile(ast.fix_missing_locations(ast.Module(
    body=ast.parse("from __future__ import annotations").body + nodes, type_ignores=[])), str(SOURCE), "exec"), ns)
show = ns["_should_show_login"]


class VisibleLoginTests(unittest.TestCase):
    def test_stays_hidden_while_not_on_login_page(self):
        self.assertFalse(show(headless=True, show_on_login=True, login_since=None, now=100))

    def test_stays_hidden_during_short_auto_login(self):
        self.assertFalse(show(headless=True, show_on_login=True, login_since=100, now=110))

    def test_opens_window_when_login_page_persists_15s(self):
        self.assertTrue(show(headless=True, show_on_login=True, login_since=100, now=115))

    def test_opens_window_immediately_for_mfa_prompt(self):
        self.assertTrue(show(headless=True, show_on_login=True, login_since=100, now=101,
                             page_text="Approve sign in request. Open your Authenticator app"))

    def test_silent_refresh_never_opens_window(self):
        self.assertFalse(show(headless=True, show_on_login=False, login_since=0, now=999,
                              page_text="authenticator"))

    def test_already_visible_does_not_reopen(self):
        self.assertFalse(show(headless=False, show_on_login=True, login_since=0, now=999))

    def test_session_starts_hidden_and_silent_refresh_opts_out(self):
        self.assertIn("driver = _make_driver(headless=True, profile_dir=profile_dir)", TEXT)
        agent = (SOURCE.parents[1] / "pc_agent.py").read_text(encoding="utf-8")
        self.assertIn("show_on_login=False", agent)


if __name__ == "__main__":
    unittest.main()
