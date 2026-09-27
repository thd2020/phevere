"""Bundle offline speech into Android; downloads happen at build time, never on the phone."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import urllib.request

APP = Path(__file__).resolve().parents[1] / 'android' / 'app'
CACHE = APP / 'build' / 'speech-downloads'
OUT = APP / 'build' / 'generated' / 'speech'
VERSION = 'kokoro-v1-sherpa-1.13.3'
ASSETS = [
    ('sherpa-onnx-1.13.3.aar',
     'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-1.13.3.aar',
     '243ad797a3b6e75ebbeaf7a2ab4aec0777e7d71b730685abb762a120940b07b6'),
    ('kokoro-multi-lang-v1_0.tar.bz2',
     'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
     'c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298'),
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
    model_root = OUT / 'assets' / 'speech'
    marker = model_root / 'bundle.json'
    if not marker.exists() or json.loads(marker.read_text())['version'] != VERSION:
        model_root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(CACHE / ASSETS[1][0]) as archive:
            archive.extractall(model_root, filter='data')
        model = model_root / 'kokoro-multi-lang-v1_0'
        for name in ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt', 'LICENSE']:
            if not (model / name).is_file():
                raise RuntimeError('Missing bundled speech file: ' + name)
        marker.write_text(json.dumps({'version': VERSION, 'sources': ASSETS}, indent=2), encoding='utf-8')
    print('Offline speech bundle ready:', OUT, flush=True)


if __name__ == '__main__':
    main()
