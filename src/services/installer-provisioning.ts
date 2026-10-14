import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { log } from '../logger';
import { installAndSelectVoice, type VoiceId } from './speech';

const MODEL_VOICES: Record<string, VoiceId> = {
  'kokoro-compact': 'compact',
  'kokoro-full': 'full',
};

interface InstallOptions {
  audioModel?: string;
  audioProvisioning?: { status: 'complete' | 'failed'; model: string; error?: string };
  [key: string]: unknown;
}

/** Complete an explicitly selected installer download without delaying app startup. */
export async function provisionInstallerAudio(): Promise<void> {
  const file = path.join(app.getPath('userData'), 'install-options.json');
  let source: string;
  let options: InstallOptions;
  try {
    source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    options = JSON.parse(source);
  } catch (err) {
    if (fs.existsSync(file)) log.warn('installer', 'could not read installation choices', { err: String(err) });
    return;
  }
  if (!options || typeof options !== 'object') return;
  const model = options.audioModel;
  const voice = model === 'kokoro-compact' || model === 'kokoro-full' ? MODEL_VOICES[model] : undefined;
  // No selection must preserve an existing voice during an in-place upgrade.
  if (!voice || (options.audioProvisioning?.model === model && options.audioProvisioning.status === 'complete')) return;
  try {
    await installAndSelectVoice(voice);
    options.audioProvisioning = { status: 'complete', model };
    log.info('installer', 'selected pronunciation voice is ready', { model });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    options.audioProvisioning = { status: 'failed', model, error };
    log.warn('installer', 'pronunciation voice installation will retry on next launch', { model, error });
  }
  try {
    // A newer installer may have replaced the choices while the download ran.
    if (fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') !== source) return;
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(options, null, 2));
    fs.renameSync(temporary, file);
  } catch (err) {
    log.warn('installer', 'could not save pronunciation provisioning result', { err: String(err) });
  }
}
