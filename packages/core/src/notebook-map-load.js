/*
 * Loads the 3D map scene, and with it three.js and 3d-force-graph, on first use.
 *
 * This file is plain JavaScript on purpose. The desktop build compiles TypeScript to
 * CommonJS, which rewrites import() into require() and would pull the whole 3D stack into
 * the first bundle. Webpack and Vite both keep the import() below as a separate chunk.
 */
let pending = null;

export function loadMapScene() {
  if (!pending) {
    pending = import('./notebook-map-3d').catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}
