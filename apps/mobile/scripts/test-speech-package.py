"""Check the generated APK inputs: mechanical data/ABI present, neural model absent."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1] / 'android/app/build/generated/speech-v2'
with zipfile.ZipFile(root / 'assets/speech/espeak-data.zip') as data:
    names = data.namelist()
    for name in ['en_dict', 'cmn_dict', 'phondata', 'phonindex', 'phontab']:
        assert 'espeak-ng-data/' + name in names, name
    assert any(n.startswith('espeak-ng-data/lang/') for n in names)
for abi in ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']:
    binary = (root / 'jniLibs' / abi / 'libttsespeak.so').read_bytes()
    assert binary.startswith(b'\x7fELF')
    for method in ['nativeClassInit', 'nativeCreate', 'nativeSetVoiceByProperties', 'nativeSetParameter', 'nativeSynthesize']:
        assert ('Java_com_reecedunn_espeak_SpeechSynthesis_' + method).encode() in binary, (abi, method)
assert not list((root / 'assets').rglob('*.onnx')), 'Neural model must be opt-in'
size = sum(p.stat().st_size for p in (root / 'assets').rglob('*') if p.is_file())
assert size < 12_000_000, f'Unexpected speech assets size: {size}'
print(f'Mechanical speech package passed: four ABIs, English/Mandarin data, {size:,} asset bytes, no neural model')
