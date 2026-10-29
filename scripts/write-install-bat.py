"""Build the release installer with this release's zip address filled in."""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "scripts" / "install.ps1"
HEADER = [
    "@echo off",
    "setlocal EnableExtensions",
    'set "BLC_BAT=%~f0"',
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -Command "
    '"$code = (Get-Content -LiteralPath $env:BLC_BAT | '
    'Select-Object -Skip 5) -join [char]10; Invoke-Expression $code"',
    "exit /b %ERRORLEVEL%",
]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: write-install-bat.py <tag> <output>")
    tag = sys.argv[1].strip()
    if not tag or "/" in tag or "\\" in tag or ".." in tag:
        raise SystemExit(f"refusing tag {tag!r}")
    url = (
        "https://github.com/12boost/better-lol-chat/releases/download/"
        f"{tag}/better-lol-chat.zip"
    )
    script = TEMPLATE.read_text(encoding="utf-8").replace("__ZIP_URL__", url)
    if "__ZIP_URL__" in script or url not in script:
        raise SystemExit("install.ps1 download address was not set")
    script = script.replace("\r\n", "\n").replace("\n", "\r\n")
    if not script.endswith("\r\n"):
        script += "\r\n"
    header = "\r\n".join(HEADER) + "\r\n"
    pathlib.Path(sys.argv[2]).write_bytes((header + script).encode("ascii"))


if __name__ == "__main__":
    main()
