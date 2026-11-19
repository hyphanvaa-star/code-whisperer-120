"""Tự phục hồi / tự cập nhật: không cần Windows hay mạng."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

path = Path(__file__).parents[1] / "bootstrap.py"
spec = importlib.util.spec_from_file_location("helper_bootstrap", path)
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)


def pack(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n, t in files.items():
            z.writestr(n, t)
    return buf.getvalue()


GOOD = {"background.py": "x=1\n", "pc_agent.py": "VERSION='6.10'\n", "tool/a.py": "y=2\n"}


class BootstrapTests(unittest.TestCase):
    def test_version_order_is_numeric(self):
        self.assertTrue(boot.newer("6.10", "6.9"))
        self.assertFalse(boot.newer("6.9", "6.10"))
        self.assertFalse(boot.newer("6.10", "6.10"))
        self.assertTrue(boot.newer("6.10", ""))

    def test_wrong_hash_keeps_old_app(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / "app").mkdir()
            (base / "app" / "pc_agent.py").write_text("old")
            data = pack(GOOD)
            with self.assertRaises(ValueError):
                boot.install_update(base, data, {"version": "6.10", "sha256": "00"}, "")
            self.assertEqual((base / "app" / "pc_agent.py").read_text(), "old")
            self.assertFalse((base / "version.txt").exists())

    def test_good_update_replaces_code_and_keeps_config(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / "app").mkdir()
            (base / "app" / "pc_agent_config.json").write_text('{"tool_dir":"D:/x"}')
            data = pack(GOOD)
            boot.install_update(base, data, {"version": "6.10", "sha256": hashlib.sha256(data).hexdigest()}, "")
            self.assertEqual(boot.local_version(base), "6.10")
            self.assertEqual((base / "app" / "pc_agent_config.json").read_text(), '{"tool_dir":"D:/x"}')
            self.assertTrue((base / "app" / "tool" / "a.py").exists())

    def test_package_missing_agent_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            data = pack({"background.py": "x"})
            with self.assertRaises(ValueError):
                boot.install_update(Path(d), data, {"version": "6.10", "sha256": hashlib.sha256(data).hexdigest()}, "")

    def test_missing_code_means_reinstall(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "version.txt").write_text("6.10")
            self.assertEqual(boot.local_version(Path(d)), "")

    def test_unwritable_drive_falls_back(self):
        with tempfile.TemporaryDirectory() as d:
            blocked = Path(d) / "file"
            blocked.write_text("x")  # a file cannot become a folder
            self.assertEqual(boot.choose_base([blocked / "sub", Path(d) / "ok"]), Path(d) / "ok")


if __name__ == "__main__":
    unittest.main()
