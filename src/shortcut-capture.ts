/**
 * Build an Electron accelerator string from a keydown event (for globalShortcut / settings).
 * Returns null if the event is modifier-only or unrecognized.
 */

function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) || navigator.userAgent.includes('Mac');
}

/** Map non-printable / special keys to Electron accelerator names. */
function keyToAcceleratorToken(ev: KeyboardEvent): string | null {
  const k = ev.key;
  if (k === 'Dead' || k === 'Unidentified') {
    return null;
  }
  if (k === 'Escape') {
    return null;
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) {
    return null;
  }

  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    ContextMenu: 'ContextMenu',
    CapsLock: 'Capslock',
    NumLock: 'Numlock',
    ScrollLock: 'Scrolllock',
    PrintScreen: 'PrintScreen',
    AudioVolumeMute: 'VolumeMute',
    AudioVolumeDown: 'VolumeDown',
    AudioVolumeUp: 'VolumeUp',
    MediaTrackNext: 'MediaNextTrack',
    MediaTrackPrevious: 'MediaPreviousTrack',
    MediaStop: 'MediaStop',
    MediaPlayPause: 'MediaPlayPause',
  };
  if (named[k]) {
    return named[k];
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(k)) {
    return k.toUpperCase();
  }

  if (k.length === 1) {
    const c = k.toUpperCase();
    if (/[A-Z0-9]/.test(c)) {
      return c;
    }
    const punct: Record<string, string> = {
      '`': '`',
      '-': '-',
      '=': '=',
      '[': '[',
      ']': ']',
      '\\': '\\',
      ';': ';',
      "'": "'",
      ',': ',',
      '.': '.',
      '/': '/',
      '+': 'Plus',
    };
    if (punct[k]) {
      return punct[k];
    }
  }

  // Fallback: physical code (helps when key is wrong for layout)
  const code = ev.code;
  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase();
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  if (code.startsWith('Numpad')) {
    return null;
  }

  return null;
}

export function keyboardEventToElectronAccelerator(ev: KeyboardEvent): string | null {
  const mac = isMac();
  const parts: string[] = [];

  if (mac) {
    if (ev.metaKey) {
      parts.push('CommandOrControl');
    }
    if (ev.ctrlKey) {
      parts.push('Control');
    }
  } else {
    if (ev.ctrlKey) {
      parts.push('CommandOrControl');
    }
    if (ev.metaKey) {
      parts.push('Super');
    }
  }
  if (ev.altKey) {
    parts.push('Alt');
  }
  if (ev.shiftKey) {
    parts.push('Shift');
  }

  const token = keyToAcceleratorToken(ev);
  if (!token) {
    return null;
  }

  // Require at least one modifier for typical global shortcuts (single F-keys etc. still ok)
  parts.push(token);
  return parts.join('+');
}

/**
 * Listen for the next key chord. Escape cancels (calls onDone(null)).
 * Returns a disposer to cancel listening.
 */
export function captureNextShortcut(onDone: (accelerator: string | null) => void): () => void {
  const handler = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopImmediatePropagation();

    if (e.key === 'Escape') {
      cleanup();
      onDone(null);
      return;
    }

    const acc = keyboardEventToElectronAccelerator(e);
    if (acc) {
      cleanup();
      onDone(acc);
    }
  };

  const cleanup = (): void => {
    window.removeEventListener('keydown', handler, true);
  };

  window.addEventListener('keydown', handler, true);
  return cleanup;
}
