import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const androidWww = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www');
const iosPublic = path.join(root, 'ios', 'App', 'App', 'public');

if (!existsSync(dist)) {
  console.error('apps/mobile/dist missing — run vite build first');
  process.exit(1);
}

async function sync(dest) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(dist, dest, { recursive: true });
  console.log('synced', dest);
}

await sync(androidWww);
await sync(iosPublic);
