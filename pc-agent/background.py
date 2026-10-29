"""Windows-only hidden launcher. No service/install/admin rights required."""
from __future__ import annotations

import ctypes
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import runpy
import sys
import threading

ROOT = Path(__file__).resolve().parent
MUTEX = "Local\\SoheeDispatchPcAgent"
STOP_EVENT = MUTEX + "Stop"


def acquire_instance(kernel):
    handle = kernel.CreateMutexW(None, False, MUTEX)
    if not handle:
        raise OSError("Cannot create helper lock")
    if kernel.GetLastError() == 183:
        kernel.CloseHandle(handle)
        return None
    return handle


def account_name(config, environment):
    return str(environment.get("PC_AGENT_USER") or config.get("user") or "").strip()


class LogStream:
    def __init__(self, logger):
        self.logger = logger
        self.pending = ""

    def write(self, text):
        self.pending += text
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            if line.strip():
                self.logger.info(line)
        return len(text)

    def flush(self):
        if self.pending.strip():
            self.logger.info(self.pending)
        self.pending = ""


def main():
    if os.name != "nt":
        raise RuntimeError("This launcher requires Windows")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    kernel.CreateEventW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateEventW.restype = ctypes.c_void_p
    kernel.OpenEventW.argtypes = [ctypes.c_ulong, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.OpenEventW.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.SetEvent.argtypes = [ctypes.c_void_p]
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    if "--stop" in sys.argv:
        event = kernel.OpenEventW(2, False, STOP_EVENT)
        if event:
            kernel.SetEvent(event)
            kernel.CloseHandle(event)
        return

    lock = acquire_instance(kernel)
    if lock is None:
        return
    event = kernel.CreateEventW(None, True, False, STOP_EVENT)
    if not event:
        kernel.CloseHandle(lock)
        raise OSError("Cannot create helper stop event")
    try:
        logger = logging.getLogger("pc-agent")
        logger.setLevel(logging.INFO)
        handler = RotatingFileHandler(ROOT / "tro-ly.log", maxBytes=2_000_000,
                                      backupCount=2, encoding="utf-8")
        logger.addHandler(handler)
        sys.stdout = sys.stderr = LogStream(logger)
        def stop_waiter():
            if kernel.WaitForSingleObject(event, 0xFFFFFFFF) == 0:
                logger.info("Tro ly da tat theo yeu cau.")
                logging.shutdown()
                os._exit(0)
        threading.Thread(target=stop_waiter, daemon=True).start()

        cfg_path = ROOT / "pc_agent_config.json"
        config = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
        os.chdir(ROOT)
        sys.path.insert(0, str(ROOT))
        main_file = ROOT / "pc_agent.pyc"
        if not main_file.exists():
            main_file = ROOT / "pc_agent.py"
        runpy.run_path(str(main_file), run_name="__main__")
    except SystemExit:
        raise
    except Exception:
        logging.exception("Tro ly khong khoi dong duoc")
        ctypes.windll.user32.MessageBoxW(None, "Không chạy được trợ lý. Chạy cai-tro-ly.bat để cài thư viện; xem tro-ly.log nếu vẫn lỗi.", "Trợ lý Sohee", 16)
    finally:
        kernel.CloseHandle(event)
        kernel.CloseHandle(lock)


if __name__ == "__main__":
    main()