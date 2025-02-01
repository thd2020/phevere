// public/electron.js
import { app, BrowserWindow, ipcMain, clipboard, globalShortcut, Menu } from 'electron';
import { join } from 'path';
import { readFileSync } from 'fs';
const dictionaryPath = join(__dirname, '../data/dictionary.json');
const devServerURL = "http://localhost:3000";

let dictionaryData = {};
try {
  const data = readFileSync(dictionaryPath, 'utf8');
  dictionaryData = JSON.parse(data);
} catch (err) {
  console.error('Failed to load dictionary data:', err);
}
let mainWindow: BrowserWindow | null;
let popupWindow: BrowserWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      // Set the preload script path
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
  });
  // In development, you may load the React dev server:
  mainWindow.loadURL(devServerURL);
  // In production, load the built React app:
  // mainWindow.loadURL(`file://${path.join(__dirname, '../build/index.html')}`);
  mainWindow.on('closed', () => (mainWindow = null));
}

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 300,
    height: 150,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    show: false, // Start hidden
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  popupWindow.loadURL('http://localhost:3000/#/popup'); // React will have a "popup" route
}

app.whenReady().then(() => {
  createMainWindow();
  createPopupWindow();
  // Register a global shortcut for selecting text (Ctrl + Shift + L)
  globalShortcut.register('Control+Shift+L', () => {
    const selectedText = clipboard.readText().trim();
    if (selectedText) {
      console.log(`Global text selection: ${selectedText}`);
      popupWindow.webContents.send('lookup-word', selectedText);
      popupWindow.show();
    }
  });
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Lookup Selected Text",
      click: () => {
        const selectedText = clipboard.readText().trim();
        if (selectedText) {
          console.log(`Context menu lookup: ${selectedText}`);
          popupWindow.webContents.send('lookup-word', selectedText);
          popupWindow.show();
        }
      }
    }
  ]);
  mainWindow.webContents.on('context-menu', (event) => {
    contextMenu.popup();
  });
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handler for Dictionary Lookup ---
ipcMain.on('lookup-word', (event, word) => {
  console.log(`Lookup request for word: ${word}`);

  const result = {
    word,
    definition: `Definition of "${word}" goes here.`,
    etymology: `Etymology info for "${word}"...`,
  };

  // Send results to both main and pop-up windows
  mainWindow.webContents.send('lookup-result', result);
  if (popupWindow) {
    popupWindow.webContents.send('lookup-result', result);
  }
});

// --- IPC: Detect Text Selection & Show Pop-up ---
ipcMain.on('show-popup', (event, text) => {
  console.log(`Selected text: ${text}`);

  if (!text || text.length === 0) return;

  // Send lookup request
  popupWindow.webContents.send('lookup-word', text);

  // Position the pop-up near mouse cursor
  const mousePos = require('electron').screen.getCursorScreenPoint();
  popupWindow.setBounds({
    x: mousePos.x + 10,
    y: mousePos.y + 10,
    width: 300,
    height: 150,
  });

  popupWindow.show();
});