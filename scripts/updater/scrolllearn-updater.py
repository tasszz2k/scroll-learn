#!/usr/bin/env python3
"""
ScrollLearn native messaging host.

Chrome speaks to this script over stdio using the Native Messaging protocol:
  - 4 bytes little-endian length prefix
  - JSON payload of that length

Commands accepted from the extension:
  {"action": "ping"}
    -> {"ok": true, "installed_version": "<current dist version>"}

  {"action": "install", "download_url": "...", "version": "1.2.3"}
    -> {"ok": true, "installed_version": "1.2.3"}
    -> {"ok": false, "error": "..."}

The install command downloads the release zip, extracts it into a temp dir,
verifies the manifest version matches, then atomically swaps it into the
extension dir configured at install time (env: SCROLLLEARN_EXT_DIR).
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

LOG_PATH = Path.home() / ".scroll-learn" / "updater.log"


def log(msg: str) -> None:
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a") as f:
            f.write(msg + "\n")
    except Exception:
        pass


def read_message() -> dict | None:
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack("<I", raw_len)[0]
    raw = sys.stdin.buffer.read(msg_len)
    return json.loads(raw.decode("utf-8"))


def send_message(payload: dict) -> None:
    encoded = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def get_extension_dir() -> Path:
    env = os.environ.get("SCROLLLEARN_EXT_DIR")
    if not env:
        raise RuntimeError(
            "SCROLLLEARN_EXT_DIR not set. Re-run scripts/updater/install.sh."
        )
    p = Path(env).expanduser().resolve()
    if not p.exists():
        raise RuntimeError(f"Extension dir does not exist: {p}")
    if not (p / "manifest.json").exists():
        raise RuntimeError(f"Not an extension dir (no manifest.json): {p}")
    return p


def read_manifest_version(extension_dir: Path) -> str:
    with (extension_dir / "manifest.json").open() as f:
        manifest = json.load(f)
    return manifest.get("version", "unknown")


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "scrolllearn-updater"})
    with urllib.request.urlopen(req, timeout=60) as r, dest.open("wb") as out:
        shutil.copyfileobj(r, out)


def find_extension_root_in_zip(extracted: Path) -> Path:
    """The release zip may have its contents directly at root, or under a single subdir."""
    if (extracted / "manifest.json").exists():
        return extracted
    children = [c for c in extracted.iterdir() if c.is_dir()]
    if len(children) == 1 and (children[0] / "manifest.json").exists():
        return children[0]
    raise RuntimeError("Could not find manifest.json in downloaded zip")


def install_zip(zip_url: str, expected_version: str) -> str:
    ext_dir = get_extension_dir()
    log(f"installing into {ext_dir} from {zip_url} (expected v{expected_version})")

    with tempfile.TemporaryDirectory(prefix="scrolllearn-") as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / "release.zip"
        download(zip_url, zip_path)

        extract_dir = tmp_path / "extracted"
        extract_dir.mkdir()
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)

        new_root = find_extension_root_in_zip(extract_dir)
        new_version = read_manifest_version(new_root)
        if expected_version and new_version != expected_version:
            raise RuntimeError(
                f"Version mismatch: zip contains v{new_version} but expected v{expected_version}"
            )

        # Atomic-ish swap: rename old aside, move new in, then delete old.
        backup = ext_dir.parent / f"{ext_dir.name}.bak-{os.getpid()}"
        if backup.exists():
            shutil.rmtree(backup)
        ext_dir.rename(backup)
        try:
            shutil.move(str(new_root), str(ext_dir))
        except Exception:
            # Roll back
            if ext_dir.exists():
                shutil.rmtree(ext_dir)
            backup.rename(ext_dir)
            raise
        shutil.rmtree(backup, ignore_errors=True)

    log(f"installed v{new_version}")
    return new_version


def handle(msg: dict) -> dict:
    action = msg.get("action")
    if action == "ping":
        try:
            ext_dir = get_extension_dir()
            return {"ok": True, "installed_version": read_manifest_version(ext_dir)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if action == "install":
        url = msg.get("download_url")
        version = msg.get("version", "")
        if not url:
            return {"ok": False, "error": "missing download_url"}
        try:
            installed = install_zip(url, version)
            return {"ok": True, "installed_version": installed}
        except Exception as e:
            log(f"install failed: {e}")
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": f"unknown action: {action}"}


def main() -> None:
    try:
        msg = read_message()
        if msg is None:
            return
        log(f"recv: {msg.get('action')}")
        send_message(handle(msg))
    except Exception as e:
        log(f"fatal: {e}")
        try:
            send_message({"ok": False, "error": str(e)})
        except Exception:
            pass


if __name__ == "__main__":
    main()
