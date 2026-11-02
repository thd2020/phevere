/** Desktop view of the shared offline catalog (`packages/core/src/offline-catalog.ts`). */

import { catalogFor, type OfflineCatalogItem } from '@phevere/core';

export type { OfflineCatalogItem };

export const OFFLINE_CATALOG: OfflineCatalogItem[] = catalogFor('desktop');

export function getCatalogItem(id: string): OfflineCatalogItem | undefined {
  return OFFLINE_CATALOG.find((p) => p.id === id);
}
