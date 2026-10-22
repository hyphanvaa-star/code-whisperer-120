"""Outlook session regressions, independent of Windows and real credentials."""
import ast
import base64
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).parents[1] / "tool" / "outlook_web_pib.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
names = {"_b64url_json", "_jwt_claims", "_token_ok_for_mail", "ensure_fresh_token",
         "OwaError", "OwaAuthError", "OwaCancelled"}
nodes = [n for n in tree.body if (
    isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names
) or (isinstance(n, ast.Assign) and any(
    isinstance(t, ast.Name) and t.id == "_TOKEN_SAFETY_S" for t in n.targets
))]

def token(exp, aud="https://outlook.office.com"):
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp, "aud": aud}).encode()).decode().rstrip("=")
    return "header." + payload + ".fake"

def load():
    import threading
    ns = {"base64": base64, "json": json, "Any": object, "Callable": object,
          "Path": Path, "time": SimpleNamespace(time=lambda: 1000),
          "_SESSION_LOCK": threading.RLock()}
    module = ast.Module(body=ast.parse("from __future__ import annotations").body + nodes, type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(SOURCE), "exec"), ns)
    return ns

class SessionTests(unittest.TestCase):
    def test_token_with_two_minutes_left_is_usable(self):
        self.assertTrue(load()["_token_ok_for_mail"](token(1120)))

    def test_token_under_one_minute_is_refreshed(self):
        self.assertFalse(load()["_token_ok_for_mail"](token(1059)))

    def test_expired_token_is_not_usable(self):
        self.assertFalse(load()["_token_ok_for_mail"](token(999)))

    def test_non_outlook_token_is_rejected(self):
        self.assertFalse(load()["_token_ok_for_mail"](token(5000, "other-service")))

    def test_active_action_reuses_verified_cache(self):
        ns = load()
        cached = token(1120)
        probes, refreshed = [], []
        ns.update(_load_cached_token=lambda _: cached, _probe_mailbox=probes.append,
                  ensure_session=lambda **kw: refreshed.append(kw) or "new")
        self.assertEqual(ns["ensure_fresh_token"](), cached)
        self.assertEqual(probes, [cached])
        self.assertEqual(refreshed, [])

    def test_active_rejection_refreshes_once_and_keeps_failure(self):
        ns = load()
        invalidated, refreshed = [], []
        def reject(_):
            raise ns["OwaAuthError"]("Microsoft refused", status=401)
        def refresh(**kw):
            refreshed.append(kw)
            raise ns["OwaAuthError"]("MFA required", status=401)
        ns.update(_load_cached_token=lambda _: token(1120), _probe_mailbox=reject,
                  invalidate_session=invalidated.append, ensure_session=refresh)
        with self.assertRaises(ns["OwaAuthError"]):
            ns["ensure_fresh_token"]()
        self.assertEqual(invalidated, [None])
        self.assertEqual(len(refreshed), 1)

if __name__ == "__main__":
    unittest.main()