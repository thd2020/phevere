/**
 * Minimal webpack entry for the selection popup / full-lookup window.
 *
 * Do NOT import renderer.ts or index.css here. Those belong to the main window;
 * bundling them into popup-new.html overrides popup styles (e.g. `.loading {
 * display: flex }`) and can leave a dead, infinitely-spinning, unexpandable UI.
 *
 * Behavior lives in popup-new.html (+ preload).
 */
export {};
