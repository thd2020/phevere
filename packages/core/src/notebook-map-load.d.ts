import type { MapData, MapRenderer, MapRendererOptions } from './notebook-map';

export interface MapSceneModule {
  createMapScene(stage: HTMLElement, data: MapData, opts: MapRendererOptions, onDetached: () => void): MapRenderer;
}

export function loadMapScene(): Promise<MapSceneModule>;
