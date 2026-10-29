"""Tool discovery after the Windows installer removes Python sources."""
import ast
import importlib.util
from pathlib import Path
import py_compile
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).parents[1] / "pc_agent.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8"))
FUNCTION = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == "_find_tool_dir")


class ToolDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundled = self.root / "app" / "tool"
        self.bundled.mkdir(parents=True)
        self.config = {}
        scope = {"Path": Path, "_CFG": self.config, "__file__": str(self.root / "app" / "pc_agent.pyc")}
        exec(compile(ast.Module(body=[FUNCTION], type_ignores=[]), str(SOURCE), "exec"), scope)
        self.find = scope["_find_tool_dir"]
        self.addCleanup(patch.stopall)
        patch.object(Path, "home", return_value=self.root).start()

    def write_tools(self, directory, compiled=False):
        directory.mkdir(parents=True, exist_ok=True)
        for name in ("atc_check", "config"):
            source = directory / (name + ".py")
            source.write_text("VALUE = 62\n", encoding="utf-8")
            if compiled:
                py_compile.compile(str(source), cfile=str(source.with_suffix(".pyc")), doraise=True)
                source.unlink()

    def test_installed_bytecode_tools_are_found_and_importable(self):
        self.write_tools(self.bundled, compiled=True)
        found = self.find()
        self.assertEqual(found, self.bundled)
        spec = importlib.util.spec_from_file_location("installed_atc", found / "atc_check.pyc")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.VALUE, 62)

    def test_bundled_tools_win_over_saved_external_folder(self):
        self.write_tools(self.bundled)
        external = self.root / "external"
        self.write_tools(external)
        self.config["tool_dir"] = str(external)
        self.assertEqual(self.find(), self.bundled)

    def test_legacy_configured_bytecode_folder_still_works(self):
        external = self.root / "external"
        self.write_tools(external, compiled=True)
        self.config["tool_dir"] = str(external)
        self.assertEqual(self.find(), external)

    def test_missing_tools_never_open_a_dialog_on_retries(self):
        original = __import__
        def no_gui(name, *args, **kwargs):
            if name == "tkinter" or name.startswith("tkinter."):
                self.fail("Tool discovery must not open a folder prompt")
            return original(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=no_gui):
            for _ in range(10):
                with self.assertRaises(RuntimeError):
                    self.find()

    def test_incomplete_bundle_is_rejected(self):
        (self.bundled / "atc_check.pyc").write_bytes(b"not a complete bundle")
        with self.assertRaises(RuntimeError):
            self.find()


if __name__ == "__main__":
    unittest.main()