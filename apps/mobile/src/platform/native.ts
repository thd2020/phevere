type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

const pending = new Map<string, Pending>();

export function hasNativeBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.PhevereBridge?.call === 'function';
}

export function installNativeCallbacks(): void {
  window.__pvResolve = (id, payload) => {
    const slot = pending.get(id);
    if (!slot) return;
    pending.delete(id);
    try {
      const data = JSON.parse(payload) as { error?: string; [k: string]: unknown };
      if (data && typeof data.error === 'string' && data.error) {
        slot.reject(new Error(data.error));
        return;
      }
      slot.resolve(data);
    } catch (err) {
      slot.reject(err instanceof Error ? err : new Error(String(err)));
    }
  };
}

export function nativeCall<T>(method: string, params: unknown = {}, timeoutMs = 120_000): Promise<T> {
  const bridge = window.PhevereBridge;
  if (!bridge) return Promise.reject(new Error('native bridge missing'));
  const id =
    globalThis.crypto?.randomUUID?.() || `n-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject });
    try {
      bridge.call(method, id, JSON.stringify(params ?? {}));
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
  });
}

export function applyInsets(insets?: { top: number; bottom: number; left: number; right: number }): void {
  const next = insets || window.__pvInsets;
  if (!next) return;
  const root = document.documentElement;
  root.style.setProperty('--pv-inset-top', `${Math.max(0, next.top)}px`);
  root.style.setProperty('--pv-inset-bottom', `${Math.max(0, next.bottom)}px`);
  root.style.setProperty('--pv-inset-left', `${Math.max(0, next.left)}px`);
  root.style.setProperty('--pv-inset-right', `${Math.max(0, next.right)}px`);
}
