#!/usr/bin/env python3
"""List, show, and archive Visual Feedback batches written by the browser extension.

The extension writes one JSON batch per Submit to Downloads/visual-feedback/.
This helper is the agent-side reader: it lists unprocessed batches, prints a batch
and extracts its per-pin screenshots to PNG, and archives a batch once handled.
"""
import argparse
import base64
import json
import re
import sys
from pathlib import Path

INBOX = Path.home() / "Downloads" / "visual-feedback"
ARCHIVE = INBOX / "processed"


def _resolve(name):
    rel = re.sub(r"^visual-feedback[\\/]", "", str(name))
    cand = (INBOX / rel).resolve()
    if INBOX.resolve() not in cand.parents:
        sys.exit(f"batch not found: {name}")
    if cand.is_file():
        return cand
    sys.exit(f"batch not found: {name}")


def cmd_list(_args):
    if not INBOX.is_dir():
        print(f"no inbox yet at {INBOX}")
        return
    files = sorted(
        (f for f in INBOX.glob("vfb-*.json") if f.is_file()),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    if not files:
        print("no unprocessed batches")
        return
    for f in files:
        try:
            b = json.loads(f.read_text(encoding="utf-8"))
            n = len(b.get("annotations", []))
            host = (b.get("site") or {}).get("host", "?")
            print(f"{f.name}  |  {host}  |  {n} pin(s)  |  {b.get('pageUrl','')}")
        except Exception as e:
            print(f"{f.name}  |  (unreadable: {e})")


def _save_shots(batch, path):
    try:
        from PIL import Image
    except ImportError:
        print("(Pillow not installed - skipping screenshot extraction)")
        return
    import io
    for ann in batch.get("annotations", []):
        shot = ann.get("screenshot")
        if not (isinstance(shot, str) and shot.startswith("data:image/webp;base64,")):
            continue
        try:
            raw = base64.b64decode(shot.split(",", 1)[1], validate=True)
            out = path.with_name(f"{path.stem}-pin{ann.get('n')}.png")
            Image.open(io.BytesIO(raw)).save(out, "PNG")
            print(f"  screenshot -> {out.name}")
        except Exception as e:
            print(f"  pin {ann.get('n')}: screenshot failed ({e})")


def _load(f):
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        sys.exit(f"could not read batch {f.name}: {e}")


def cmd_show(args):
    f = _resolve(args.file)
    batch = _load(f)
    print(json.dumps(batch, indent=2, ensure_ascii=False))
    _save_shots(batch, f)


def cmd_done(args):
    f = _resolve(args.file)
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    dest = ARCHIVE / f.name
    f.replace(dest)
    print(f"archived -> {dest}")


def main():
    ap = argparse.ArgumentParser(description="Read Visual Feedback batches for your coding agent.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="list newest unprocessed batches").set_defaults(func=cmd_list)
    s = sub.add_parser("show", help="print a batch and extract its screenshots to PNG")
    s.add_argument("file")
    s.set_defaults(func=cmd_show)
    d = sub.add_parser("done", help="move a processed batch to the archive")
    d.add_argument("file")
    d.set_defaults(func=cmd_done)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
