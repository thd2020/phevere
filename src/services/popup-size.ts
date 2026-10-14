export type PopupResizeOptions = { mode?: 'strip' | 'panel'; minWidth?: number };

/** Validate renderer measurements before applying native window constraints. */
export function popupSize(width: number, height: number, options: PopupResizeOptions = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const strip = options.mode === 'strip' || (options.mode !== 'panel' && height <= 64);
  const measuredMin = Number.isFinite(options.minWidth) ? Math.ceil(options.minWidth!) : 0;
  const minWidth = Math.min(1200, Math.max(strip ? 315 : 460, measuredMin));
  const minHeight = strip ? 36 : 200;
  return {
    strip, minWidth, minHeight,
    width: Math.max(minWidth, Math.min(1200, Math.round(width))),
    height: Math.max(minHeight, Math.min(strip ? 64 : 900, Math.round(height))),
  };
}
