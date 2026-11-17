"""Ổ D: chỉ khi thật sự không có D mới dự phòng sang C; có D thì mọi file về D."""
import unittest
from unittest import mock

import pc_agent


class DriveFixTest(unittest.TestCase):
    def test_d_present_keeps_d(self):
        with mock.patch.object(pc_agent, "_has_d", return_value=True):
            self.assertEqual(str(pc_agent._fix_drive("D:\\ATC-EZFW")), "D:\\ATC-EZFW")

    def test_d_missing_falls_back_to_c(self):
        with mock.patch.object(pc_agent, "_has_d", return_value=False):
            self.assertEqual(str(pc_agent._fix_drive("D:\\ATC-EZFW")), "C:\\ATC-EZFW")

    def test_c_target_untouched(self):
        with mock.patch.object(pc_agent, "_has_d", return_value=False):
            self.assertEqual(str(pc_agent._fix_drive("C:\\FPL")), "C:\\FPL")

    def test_has_d_retries_before_giving_up(self):
        # Ổ "ngủ" 2 nhịp đầu rồi tỉnh — vẫn phải nhận ra D, không rơi về C.
        calls = {"n": 0}

        def flaky(_p):
            calls["n"] += 1
            return calls["n"] >= 3

        with mock.patch.object(pc_agent.os.path, "exists", side_effect=flaky), \
             mock.patch.object(pc_agent.Path, "exists", return_value=False), \
             mock.patch.object(pc_agent.time, "sleep", return_value=None):
            self.assertTrue(pc_agent._has_d())
            self.assertEqual(calls["n"], 3)

    def test_has_d_false_only_after_all_retries(self):
        with mock.patch.object(pc_agent.os.path, "exists", return_value=False), \
             mock.patch.object(pc_agent.Path, "exists", return_value=False), \
             mock.patch.object(pc_agent.time, "sleep", return_value=None) as sl:
            self.assertFalse(pc_agent._has_d())
            self.assertEqual(sl.call_count, 2)


if __name__ == "__main__":
    unittest.main()
