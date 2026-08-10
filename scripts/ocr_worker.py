#!/usr/bin/env python3
"""
Persistent RapidOCR worker for Phevere.

Protocol (UTF-8 JSON lines on stdin/stdout):
  → {"id": 1, "path": "C:/tmp/x.png"}
  ← {"id": 1, "ok": true, "txts": ["汉字"], "scores": [0.99], "boxes": [[[x,y],...], ...]}
  → {"id": 2, "cmd": "ping"}
  ← {"id": 2, "ok": true, "pong": true}
  → {"id": 3, "cmd": "ensure_deps"}
  ← {"id": 3, "ok": true, "installed": true, "detail": "..."}
  → {"cmd": "quit"}

Env:
  PHEVERE_OCR_MODEL_ROOT — directory for ONNX models (downloaded on first use)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import traceback


def _log_stderr(msg: str) -> None:
    try:
        sys.stderr.write(msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _pip_install() -> str:
    """Install rapidocr + onnxruntime for the current interpreter (user site)."""
    cmds = [
        [sys.executable, "-m", "pip", "install", "--user", "--upgrade", "rapidocr", "onnxruntime"],
        [sys.executable, "-m", "pip", "install", "--upgrade", "rapidocr", "onnxruntime"],
    ]
    last_err = ""
    for cmd in cmds:
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
                env={**os.environ, "PYTHONUTF8": "1"},
            )
            if proc.returncode == 0:
                return (proc.stdout or "")[-400:] or "pip install ok"
            last_err = (proc.stderr or proc.stdout or f"exit {proc.returncode}")[-500:]
        except Exception as exc:
            last_err = str(exc)
    raise RuntimeError(f"pip install rapidocr/onnxruntime failed: {last_err}")


def _build_engine():
    from rapidocr import RapidOCR

    model_root = os.environ.get("PHEVERE_OCR_MODEL_ROOT") or ""
    params = {}
    if model_root:
        os.makedirs(model_root, exist_ok=True)
        params["Global.model_root_dir"] = model_root
    if params:
        return RapidOCR(params=params)
    return RapidOCR()


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    import logging

    os.environ.setdefault("GLOG_minloglevel", "2")
    logging.disable(logging.WARNING)

    engine = None

    def ensure_engine():
        nonlocal engine
        if engine is not None:
            return engine
        try:
            engine = _build_engine()
            return engine
        except ImportError as exc:
            _log_stderr(f"RapidOCR missing, attempting pip install: {exc}")
            detail = _pip_install()
            _log_stderr(detail)
            # Fresh import after install
            if "rapidocr" in sys.modules:
                del sys.modules["rapidocr"]
            engine = _build_engine()
            return engine

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
            if cmd == "ensure_deps":
                try:
                    ensure_engine()
                    # Force a tiny warm path if models not yet downloaded — RapidOCR
                    # downloads on first recognize; report import success here.
                    print(
                        json.dumps(
                            {
                                "id": req_id,
                                "ok": True,
                                "installed": True,
                                "model_root": os.environ.get("PHEVERE_OCR_MODEL_ROOT") or "",
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
