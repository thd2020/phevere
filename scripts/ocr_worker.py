#!/usr/bin/env python3
"""
Persistent RapidOCR worker for Phevere.

Protocol (UTF-8 JSON lines on stdin/stdout):
  → {"id": 1, "path": "C:/tmp/x.png"}
  ← {"id": 1, "ok": true, "txts": ["汉字"], "scores": [0.99], "boxes": [[[x,y],...], ...]}
  → {"id": 2, "cmd": "ping"}
  ← {"id": 2, "ok": true, "pong": true}
  → {"cmd": "quit"}
"""

from __future__ import annotations

import json
import sys
import traceback


def main() -> int:
    # Line-buffered stdout so Electron sees each reply immediately.
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    # Keep RapidOCR / onnxruntime logs off stdout (JSON protocol).
    import logging
    import os

    os.environ.setdefault("GLOG_minloglevel", "2")
    logging.disable(logging.WARNING)

    engine = None

    def ensure_engine():
        nonlocal engine
        if engine is None:
            from rapidocr import RapidOCR

            engine = RapidOCR()
        return engine

    # Signal ready before loading models so Node can attach.
    print(json.dumps({"ok": True, "ready": True}, ensure_ascii=False), flush=True)

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd")
            if cmd == "quit":
                print(json.dumps({"ok": True, "bye": True}, ensure_ascii=False), flush=True)
                return 0
            if cmd == "ping":
                print(
                    json.dumps({"id": req_id, "ok": True, "pong": True}, ensure_ascii=False),
                    flush=True,
                )
                continue

            path = req.get("path")
            if not path:
                raise ValueError("missing path")

            ocr = ensure_engine()
            result = ocr(path)

            txts = list(getattr(result, "txts", None) or [])
            scores = [float(s) for s in (getattr(result, "scores", None) or [])]
            boxes_out = []
            boxes = getattr(result, "boxes", None)
            if boxes is not None:
                for box in boxes:
                    # box is typically 4 points [[x,y], ...]
                    pts = []
                    for p in box:
                        pts.append([float(p[0]), float(p[1])])
                    boxes_out.append(pts)

            print(
                json.dumps(
                    {
                        "id": req_id,
                        "ok": True,
                        "txts": txts,
                        "scores": scores,
                        "boxes": boxes_out,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        except Exception as exc:
            print(
                json.dumps(
                    {
                        "id": req_id,
                        "ok": False,
                        "error": str(exc),
                        "trace": traceback.format_exc()[-800:],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
