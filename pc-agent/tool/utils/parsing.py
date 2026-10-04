import re
def safe_filename(name, default="file"):
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", str(name or "")).strip(" .")
    return s[:180] or default
