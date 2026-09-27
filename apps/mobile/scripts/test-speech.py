"""Exercise the exact packaged model with the matching runtime, without a system TTS engine."""
from pathlib import Path
import numpy as np
import sherpa_onnx

root = Path(__file__).resolve().parents[1] / 'android/app/build/generated/speech/assets/speech/kokoro-multi-lang-v1_0'
config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=str(root / 'model.onnx'), voices=str(root / 'voices.bin'),
            tokens=str(root / 'tokens.txt'), data_dir=str(root / 'espeak-ng-data'),
            lexicon=','.join(str(root / name) for name in ['lexicon-us-en.txt', 'lexicon-zh.txt']),
        ), num_threads=2,
    ),
)
tts = sherpa_onnx.OfflineTts(config)
for text, speaker in [('Hello, world.', 0), ('Dictionary.', 20), ('你好，世界。', 45)]:
    audio = tts.generate(text, sid=speaker, speed=1.0)
    samples = np.asarray(audio.samples)
    assert len(samples) > audio.sample_rate // 5, 'Speech was empty or truncated'
    assert np.isfinite(samples).all() and np.max(np.abs(samples)) > 0.001, 'Speech was silent or invalid'
    print(f'Bundled speech passed: speaker {speaker}, {len(samples) / audio.sample_rate:.2f}s', flush=True)
