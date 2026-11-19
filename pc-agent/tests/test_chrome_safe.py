"""Trợ lý PC không bao giờ tắt Chrome của người dùng."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "tool"))
import chrome_drv  # noqa: E402


class ProfilePidTests(unittest.TestCase):
    PROFILE = Path(r"C:\Users\jack\AppData\Local\DispatchBoard\chrome_owa_profile")

    def test_user_chrome_never_selected(self):
        rows = [
            (100, r'"C:\Program Files\Google\Chrome\Application\chrome.exe"'),
            (101, r'"chrome.exe" --type=renderer --lang=vi'),
            (102, r'"chrome.exe" --user-data-dir="C:\Users\jack\AppData\Local\Google\Chrome\User Data"'),
        ]
        self.assertEqual(chrome_drv.profile_pids(rows, self.PROFILE), [])

    def test_only_tool_profile_selected(self):
        rows = [
            (100, r'"chrome.exe"'),
            (200, r'"chrome.exe" --user-data-dir="C:\Users\jack\AppData\Local\DispatchBoard\chrome_owa_profile" --profile-directory=Default'),
            (201, r'chrome.exe --type=gpu --user-data-dir=C:\Users\jack\AppData\Local\DispatchBoard\chrome_owa_profile'),
            (300, r'"chrome.exe" --user-data-dir="C:\Users\jack\AppData\Local\DispatchBoard\chrome_owa_profile_other"'),
        ]
        self.assertEqual(chrome_drv.profile_pids(rows, self.PROFILE), [200, 201])

    def test_no_profile_kills_nothing(self):
        with patch.object(chrome_drv.subprocess, "run") as run:
            chrome_drv._cleanup_chrome_profile(None)
        run.assert_not_called()
        self.assertEqual(chrome_drv.profile_pids([(1, "--user-data-dir=x")], None), [])

    def test_never_kills_by_image_name(self):
        src = (Path(chrome_drv.__file__)).read_text(encoding="utf-8")
        self.assertNotIn('"/IM", "chrome.exe"', src)


class SafeFlagTests(unittest.TestCase):
    def test_safe_flags_added_once(self):
        class Opt:
            def __init__(self):
                self.arguments = ["--no-sandbox"]
            def add_argument(self, a):
                self.arguments.append(a)
        o = Opt()
        chrome_drv.add_safe_flags(o)
        chrome_drv.add_safe_flags(o)
        self.assertEqual(sorted(o.arguments), sorted(chrome_drv.SAFE_START_FLAGS))


if __name__ == "__main__":
    unittest.main()
