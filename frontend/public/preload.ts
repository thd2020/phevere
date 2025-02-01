// preload.js
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  sendLookup: (word: any) => ipcRenderer.send('lookup-word', word),
  onLookupResult: (callback: (arg0: any) => void) => ipcRenderer.on('lookup-result', (event, result) => callback(result)),
  showPopup: (text: any) => ipcRenderer.send('show-popup', text)
});