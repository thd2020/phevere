import { installAndSelectVoice, listVoices, stopSpeechWorker } from './speech';

/** Presence of the flag, including an invalid value, must bypass normal desktop startup. */
export function installerAudioModelArgument(args: string[]): string | undefined {
  const prefix = '--install-audio-model=';
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function writeEvent(event: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(event)}\n`, (error) => error ? reject(error) : resolve());
  });
}

/** Installer subprocess. The caller exits Electron after the final stdout line is flushed. */
export async function runInstallerAudioCommand(model: string): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  try {
    if (model === 'none') {
      await writeEvent({ event: 'audio-model-complete', model, progress: 1 });
      return 0;
    }
    const voice = model === 'kokoro-compact' ? 'compact' : model === 'kokoro-full' ? 'full' : undefined;
    if (!voice) throw new Error('Unknown pronunciation model');
    await writeEvent({ event: 'audio-model-progress', model, progress: 0 });
    timer = setInterval(() => {
      const row = listVoices().find((item) => item.id === voice);
      void writeEvent({ event: 'audio-model-progress', model, progress: row?.progress || 0 }).catch(() => { /* parent may have closed */ });
    }, 250);
    await installAndSelectVoice(voice);
    clearInterval(timer);
    timer = undefined;
    await writeEvent({ event: 'audio-model-complete', model, progress: 1 });
    return 0;
  } catch (error) {
    await writeEvent({ event: 'audio-model-error', model, error: error instanceof Error ? error.message : String(error) })
      .catch(() => { /* parent may have closed */ });
    return 1;
  } finally {
    if (timer) clearInterval(timer);
    stopSpeechWorker();
  }
}
