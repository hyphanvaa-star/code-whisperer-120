"""Tự cập nhật không được tắt trợ lý giữa ca; lỗi cập nhật phải báo lên web."""
import ast
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parents[1]
TEXT = (HERE / "pc_agent.py").read_text(encoding="utf-8")
tree = ast.parse(TEXT)
spec = importlib.util.spec_from_file_location("helper_bootstrap2", HERE / "bootstrap.py")
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)


def fn_src(name):
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    return ast.get_source_segment(TEXT, node)


class UpdatePolicyTests(unittest.TestCase):
    def test_periodic_check_never_exits_mid_shift(self):
        src = fn_src("_maybe_self_update")
        self.assertNotIn("os._exit", src)
        self.assertNotIn("Popen", src)

    def test_update_now_refuses_while_a_job_runs(self):
        src = fn_src("_start_update_now")
        self.assertIn('if _CURRENT_JOB[0]:\n        return False, "busy"', src)

    def test_heartbeat_thread_started_and_never_claims_jobs(self):
        self.assertIn('target=_heartbeat_keeper', TEXT)
        self.assertIn('"heartbeat_only": True', fn_src("_heartbeat_keeper"))

    def test_failed_update_written_for_web(self):
        with tempfile.TemporaryDirectory() as d:
            boot.write_status(Path(d), False, "6.13", "6.12", "mất mạng")
            st = json.loads((Path(d) / boot.STATUS_FILE).read_text(encoding="utf-8"))
            self.assertEqual((st["ok"], st["want"], st["have"], st["error"]), (False, "6.13", "6.12", "mất mạng"))


if __name__ == "__main__":
    unittest.main()
