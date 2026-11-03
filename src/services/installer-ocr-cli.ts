import { getOcrPackState, installOcrPack, onOcrPackChange } from './ocr-pack';

export const INSTALL_OCR_PACK_FLAG = '--install-ocr-pack';

function writeEvent(event: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(event)}\n`, (error) => error ? reject(error) : resolve());
  });
}

/**
 * Setup frontend subprocess: install the OCR pack and report JSON lines on stdout
 * (ocr-pack-progress, ocr-pack-complete, ocr-pack-error). The caller exits Electron.
 */
export async function runInstallerOcrCommand(): Promise<number> {
  const stop = onOcrPackChange((state) => {
    if (state.installing) void writeEvent({ event: 'ocr-pack-progress', progress: state.progress }).catch(() => { /* parent may have closed */ });
  });
  try {
    if (!getOcrPackState().installed) {
      await writeEvent({ event: 'ocr-pack-progress', progress: 0 });
      await installOcrPack();
    }
    await writeEvent({ event: 'ocr-pack-complete', progress: 1 });
    return 0;
  } catch (error) {
    await writeEvent({ event: 'ocr-pack-error', error: error instanceof Error ? error.message : String(error) })
      .catch(() => { /* parent may have closed */ });
    return 1;
  } finally {
    stop();
  }
}
