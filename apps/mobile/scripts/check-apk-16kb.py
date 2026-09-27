"""Fail when a 64-bit native library in the APK would break on 16 KB page devices."""
from pathlib import Path
import struct
import sys
import zipfile

PAGE = 16384


def load_aligns(elf):
    phoff, = struct.unpack_from('<Q', elf, 0x20)
    size, count = struct.unpack_from('<HH', elf, 0x36)
    return [struct.unpack_from('<Q', elf, phoff + i * size + 48)[0]
            for i in range(count) if struct.unpack_from('<I', elf, phoff + i * size)[0] == 1]


apk = Path(sys.argv[1] if len(sys.argv) > 1 else 'android/app/build/outputs/apk/debug/app-debug.apk')
bad = []
with zipfile.ZipFile(apk) as archive, apk.open('rb') as raw:
    libs = [i for i in archive.infolist() if i.filename.startswith(('lib/arm64-v8a/', 'lib/x86_64/')) and i.filename.endswith('.so')]
    for info in libs:
        raw.seek(info.header_offset + 26)
        name_len, extra_len = struct.unpack('<HH', raw.read(4))
        offset = info.header_offset + 30 + name_len + extra_len
        aligns = load_aligns(archive.read(info))
        if min(aligns) < PAGE:
            bad.append(f'{info.filename}: LOAD align {min(aligns)}')
        if info.compress_type == zipfile.ZIP_STORED and offset % PAGE:
            bad.append(f'{info.filename}: zip offset {offset} not 16 KB aligned')
if bad:
    sys.exit('Not 16 KB compatible:\n  ' + '\n  '.join(bad))
print(f'16 KB page check passed for {len(libs)} native libraries')
