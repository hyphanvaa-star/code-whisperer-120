# pc-agent notes

- `background.py` runs hidden (pythonw, session mutex, stop event). Bootstrap picks the first writable dir (D:\.TroLyPC, then LOCALAPPDATA), stages+compiles `app.zip` before overwriting, keeps runtime files; the agent checks `manifest.json` every 10 min between jobs and hands off via `bootstrap.py --after <pid>`. AGENT dot polls `GET /api/pc/status`. `pack.py` is the explicit allowlist for all `public/agent` files.
- Chrome cleanup (`tool/chrome_drv.py`) only kills processes whose `--user-data-dir` equals the tool profile and starts with `SAFE_START_FLAGS`; never `taskkill /IM chrome.exe`, which closes the user's own Chrome.
