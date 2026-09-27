"""Check the generated APK inputs: mechanical data/ABI present, neural model absent."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1] / 'android/app/build/generated/speech-v2'
with zipfile.ZipFile(root / 'assets/speech/espeak-data.zip') as data:
    names = data.namelist()
    for name in ['en_dict', 'cmn_dict', 'phondata', 'phonindex', 'phontab']:
        assert 'espeak-ng-data/' + name in names, name
    assert any(n.startswith('espeak-ng-data/lang/') for n in names)
jni = (root / 'espeak-ng-src/android/jni/jni/eSpeakService.c').read_text(encoding='utf-8')
for method in ['nativeClassInit', 'nativeCreate', 'nativeSetVoiceByProperties', 'nativeSetParameter', 'nativeSynthesize']:
    assert 'Java_com_reecedunn_espeak_SpeechSynthesis_' + method in jni, method
assert 'espeakCHARS_UTF8 | espeakPHONEMES' in jni, 'IPA chips need [[phoneme]] input'
assert not (root / 'jniLibs').exists(), 'libttsespeak.so must be built from source, not copied'
assert not list((root / 'assets').rglob('*.onnx')), 'Neural model must be opt-in'
size = sum(p.stat().st_size for p in (root / 'assets').rglob('*') if p.is_file())
assert size < 12_000_000, f'Unexpected speech assets size: {size}'
print(f'Mechanical speech package passed: eSpeak JNI source, English/Mandarin data, {size:,} asset bytes, no neural model')
