"""Bundle mechanical speech and neural runtime. Neural model downloads are opt-in on device."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import zipfile
import io
import urllib.request

APP = Path(__file__).resolve().parents[1] / 'android' / 'app'
CACHE = APP / 'build' / 'speech-downloads'
OUT = APP / 'build' / 'generated' / 'speech-v2'
VERSION = 'espeak-1.52.0-sherpa-1.13.3'
ASSETS = [
    ('sherpa-onnx-1.13.3.aar',
     'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-1.13.3.aar',
     '243ad797a3b6e75ebbeaf7a2ab4aec0777e7d71b730685abb762a120940b07b6'),
    ('espeak-1.52.0-signed.apk',
     'https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-1.52.0-signed.apk',
     '741b46abf84d843f9b0cce80136f60ffee9b9fe591601b9701aa2a9ff99c9ddf'),
    ('espeak-ng-1.52.0.tar.gz',
     'https://codeload.github.com/espeak-ng/espeak-ng/tar.gz/refs/tags/1.52.0',
     'bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23'),
]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, url, sha in ASSETS:
        dest = CACHE / name
        if not dest.exists() or digest(dest) != sha:
            print('Downloading', name, flush=True)
            partial = dest.with_suffix('.partial')
            with urllib.request.urlopen(url, timeout=120) as response, partial.open('wb') as stream:
                shutil.copyfileobj(response, stream)
            if digest(partial) != sha:
                raise RuntimeError('Speech download checksum mismatch: ' + name)
            partial.replace(dest)
        print('Verified', name, flush=True)
    shutil.copy2(CACHE / ASSETS[0][0], OUT / ASSETS[0][0])
    voice_root = OUT / 'assets' / 'speech'
    voice_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(CACHE / ASSETS[1][0]) as apk:
        # Resource names are obfuscated in the official APK; identify the data by contents.
        data = [apk.read(n) for n in apk.namelist() if n.endswith('.zip')]
        data = [b for b in data if 'espeak-ng-data/en_dict' in zipfile.ZipFile(io.BytesIO(b)).namelist()]
        if len(data) != 1:
            raise RuntimeError('Missing or ambiguous eSpeak voice data')
        (voice_root / 'espeak-data.zip').write_bytes(data[0])
        for abi in ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']:
            dest = OUT / 'jniLibs' / abi / 'libttsespeak.so'
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(apk.read(f'lib/{abi}/libttsespeak.so'))
    notices = OUT / 'assets' / 'speech-notices'
    notices.mkdir(parents=True, exist_ok=True)
    with tarfile.open(CACHE / ASSETS[2][0]) as source:
        for name in ['COPYING', 'COPYING.APACHE', 'COPYING.BSD2', 'COPYING.UCD']:
            (notices / ('espeak-' + name)).write_bytes(source.extractfile('espeak-ng-1.52.0/' + name).read())
    sources = OUT / 'sources'
    sources.mkdir(parents=True, exist_ok=True)
    shutil.copy2(CACHE / ASSETS[2][0], sources / ASSETS[2][0])
    (voice_root / 'bundle.json').write_text(json.dumps({'version': VERSION, 'sources': ASSETS}, indent=2), encoding='utf-8')
    print('Offline speech bundle ready:', OUT, flush=True)


if __name__ == '__main__':
    main()
