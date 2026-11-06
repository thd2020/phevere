import { hasNativeBridge, nativeCall } from './native';

/**
 * Launcher icons of the apps words were saved from, for Words, Sources. Each app is asked for
 * once per session; `onIcon` repaints when an icon arrives.
 */
const icons = new Map<string, string>();
const asked = new Set<string>();

export function appIconSource(onIcon: () => void): (appId: string) => string {
  return (appId) => {
    const hit = icons.get(appId);
    if (hit !== undefined) return hit;
    if (!asked.has(appId) && hasNativeBridge()) {
      asked.add(appId);
      void nativeCall<{ png?: string | null }>('appIcon', { id: appId }, 10_000)
        .then((res) => {
          icons.set(appId, res.png ? `data:image/png;base64,${res.png}` : '');
          if (res.png) onIcon();
        })
        .catch(() => icons.set(appId, ''));
    }
    return '';
  };
}
