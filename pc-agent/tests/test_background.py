"""Hidden helper lifecycle checks without Windows or live accounts."""
import importlib.util
import logging
from pathlib import Path
import unittest
from unittest.mock import Mock

path = Path(__file__).parents[1] / "background.py"
spec = importlib.util.spec_from_file_location("helper_background", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackgroundTests(unittest.TestCase):
    def test_second_start_does_not_create_another_helper(self):
        kernel = Mock()
        kernel.CreateMutexW.return_value = 123
        kernel.GetLastError.return_value = 183
        self.assertIsNone(module.acquire_instance(kernel))
        kernel.CloseHandle.assert_called_once_with(123)

    def test_first_start_keeps_lock_open(self):
        kernel = Mock()
        kernel.CreateMutexW.return_value = 123
        kernel.GetLastError.return_value = 0
        self.assertEqual(module.acquire_instance(kernel), 123)
        kernel.CloseHandle.assert_not_called()

    def test_missing_lock_blocks_start(self):
        kernel = Mock()
        kernel.CreateMutexW.return_value = None
        with self.assertRaises(OSError):
            module.acquire_instance(kernel)

    def test_saved_login_is_preserved(self):
        self.assertEqual(module.account_name({"user": "hyphan"}, {}), "hyphan")

    def test_environment_login_takes_precedence(self):
        self.assertEqual(module.account_name({"user": "hyphan"}, {"PC_AGENT_USER": "dispatcher"}), "dispatcher")

    def test_missing_login_requires_pairing(self):
        self.assertEqual(module.account_name({}, {}), "")

    def test_console_output_is_saved_without_console(self):
        logger = Mock(spec=logging.Logger)
        stream = module.LogStream(logger)
        stream.write("first")
        logger.info.assert_not_called()
        stream.write(" line\nsecond")
        stream.flush()
        self.assertEqual([call.args[0] for call in logger.info.call_args_list], ["first line", "second"])


if __name__ == "__main__":
    unittest.main()