# OCR models for development (PP-OCRv4 mobile)

Apache-2.0 weights from the PaddleOCR / RapidOCR family. Since 2026-11-03 packages do not include them: the app downloads the OCR pack (`src/services/ocr-pack.ts`, built by `scripts/make-ocr-pack.js`). This folder only serves `npm start`.

| File | Role |
|------|------|
| `ch_PP-OCRv4_det_infer.onnx` | Text detection |
| `ch_PP-OCRv4_rec_infer.onnx` | Text recognition (CJK + Latin) |
| `ch_ppocr_mobile_v2.0_cls_infer.onnx` | Optional text-line orientation |
| `ppocr_keys_v1.txt` | Recognition dictionary |

A packaged app loads the downloaded pack from `userData/ocr-packs/pp-ocrv4`, or `process.resourcesPath/ocr-models` where a 3.0 or earlier installer put them. In development it falls back to this folder.

Refresh from the npm package:

```bash
node scripts/sync-ocr-models.js
```
