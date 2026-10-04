import os
def atomic_replace(src, dst):
    os.replace(str(src), str(dst))
