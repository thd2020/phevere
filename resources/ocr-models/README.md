# Embedded OCR models (PP-OCRv4 mobile)

Apache-2.0 weights from the PaddleOCR / RapidOCR family, vendored for offline install.

| File | Role |
|------|------|
| `ch_PP-OCRv4_det_infer.onnx` | Text detection |
| `ch_PP-OCRv4_rec_infer.onnx` | Text recognition (CJK + Latin) |
| `ch_ppocr_mobile_v2.0_cls_infer.onnx` | Optional text-line orientation |
| `ppocr_keys_v1.txt` | Recognition dictionary |

Runtime loads these from `process.resourcesPath/ocr-models` (packaged) or `resources/ocr-models` (dev) via the native `onnxruntime-node` engine (`@gutenye/ocr-node` pipeline).

Refresh from the npm package:

```bash
node scripts/sync-ocr-models.js
```
