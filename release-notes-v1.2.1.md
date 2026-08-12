## Downloads

- **Windows x64 Setup:** `Phevere-Setup-1.2.1-x64.exe` (NSIS assisted installer; single bundle includes optional OCR models)

## Requirements

- Windows 10/11 x64
- Administrator elevation recommended for system-wide UIAutomation selection

## Highlights

- Native ONNX OCR (embedded PP-OCRv4) + pluggable OCR packs
- Wikipedia in-popup webview; etymology source tabs; vocab notebook polish
- Installer: `Program Files\Phevere`, components page, Uninstall shortcut / Apps entry
- Stability: vocab persist, IPA after lemma pivot, orderly Quit, popup load harden

## Ghost installs

If an older Phevere folder remains under Program Files with no Apps entry, run `scripts/remove-ghost-phevere.ps1` from the repo, then install this Setup.

## SHA-256

`0692CD0FA4C23B8AAD7632335F8F556C7897765EEC711A0C0E07FDA70B9B0ADC  Phevere-Setup-1.2.1-x64.exe`

Full notes: see CHANGELOG `[1.2.1]`.
