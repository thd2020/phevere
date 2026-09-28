import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

// iOS version: MARKETING_VERSION follows package.json, like Android's versionName. The app and
// its share extension must carry the same version. The build number (CURRENT_PROJECT_VERSION)
// is the commit count, passed by CI on the xcodebuild command line.
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const pbxproj = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const before = await readFile(pbxproj, 'utf8');
const after = before.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
if (after !== before) {
  await writeFile(pbxproj, after);
  console.log('iOS MARKETING_VERSION', version);
}
