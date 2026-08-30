import { registerPlugin } from '@capacitor/core';

export interface ProcessTextPlugin {
  getPendingText(): Promise<{ text: string | null }>;
}

const ProcessText = registerPlugin<ProcessTextPlugin>('ProcessText', {
  web: {
    getPendingText: async () => ({ text: null }),
  },
});

export { ProcessText };
