"""Electron-Ausgabe fuer Windows 7/8/8.1, 32 Bit (ia32).

Electron unterstuetzt Windows 7 nur bis Version 22 (Chromium 108). Dieses
Werkzeug nutzt build_tool_electron.py unveraendert und tauscht nur:
  - node_modules: ~/afc-build-win7 (electron 22.3.27 + electron-builder)
  - Architektur: ia32 statt x64, nur Ziel "win"
  - Namenszusatz "Win7-32"

Einmalig:  npm install --prefix %USERPROFILE%\afc-build-win7 electron@22.3.27 electron-builder@25.1.8
Aufruf:    BUILD_TOOL_ELECTRON_WIN7.bat   (Oberflaeche)
           py -3 build_tool_electron_win7.py --cli [--version 1.8] ...

Hinweis: Electron 22 bekommt seit 2023 keine Sicherheitsupdates mehr.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_tool_electron as be                           # noqa: E402

ELECTRON_VERSION = "22.3.27"
SUFFIX = " Win7-32"

be.NODE_MODULES = os.path.join(os.path.expanduser("~"), "afc-build-win7", "node_modules")
be.TARGETS = ("win",)
be.BASENAME = be.BASENAME  # Name bekommt den Zusatz in run_build

_orig_patch = be.patch_package_json
_orig_run = be.run_build


def patch_package_json(src, name, version, target, stage_files):
    pkg = json.loads(_orig_patch(src, name, version, target, stage_files))
    b = pkg["build"]
    b["electronVersion"] = ELECTRON_VERSION
    b.setdefault("win", {})["target"] = [{"target": "portable", "arch": ["ia32"]}]
    pkg.setdefault("devDependencies", {})["electron"] = ELECTRON_VERSION
    return json.dumps(pkg, indent=2, ensure_ascii=False)


def run_build(cfg, log, cancel=None):
    if cfg.get("target", "win") != "win":
        raise RuntimeError("Die Win7-Ausgabe gibt es nur fuer Windows.")
    if not cfg["name"].endswith(SUFFIX):
        cfg["name"] += SUFFIX
    log("Win7-32: Electron %s, ia32" % ELECTRON_VERSION)
    return _orig_run(cfg, log, cancel)


be.patch_package_json = patch_package_json
be.run_build = run_build

if __name__ == "__main__":
    if "--cli" in sys.argv:
        be.run_cli([x for x in sys.argv[1:] if x != "--cli"])
    else:
        be.run_ui()
