const path = require('path');

function loadMonitorClass() {
  if (process.platform === 'darwin') {
    const binding = require('./build/Release/ax_selection_monitor.node');
    return binding.AXSelectionMonitor;
  }
  const binding = require('./build/Release/uiautomation_selection_monitor.node');
  return binding.UIAutomationSelectionMonitor;
}

const MonitorClass = loadMonitorClass();

class NativeSelectionMonitor {
  constructor() {
    this.monitor = new MonitorClass();
    this.isRunning = false;
    this.callbacks = [];
    this.method = process.platform === 'darwin' ? 'accessibility' : 'uiautomation';
  }

  /**
   * Start monitoring for text selections (UIA on Windows, AX on macOS).
   */
  start() {
    if (this.isRunning) {
      console.log('[NATIVE-ADDON] Already running');
      return false;
    }

    try {
      this.monitor.setCallback((text, x, y) => {
        console.log(`[NATIVE-ADDON] Selection detected: "${text}" @ (${x}, ${y})`);
        this.notifyCallbacks({ text, x, y });
      });

      const result = this.monitor.start();
      if (result) {
        this.isRunning = true;
        console.log(`[NATIVE-ADDON] ${this.method} selection monitoring started`);
        return true;
      }
      console.error(`[NATIVE-ADDON] Failed to start ${this.method} monitoring`);
      return false;
    } catch (error) {
      console.error('[NATIVE-ADDON] Error starting monitoring:', error);
      return false;
    }
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      this.monitor.stop();
      this.isRunning = false;
      console.log(`[NATIVE-ADDON] ${this.method} selection monitoring stopped`);
    } catch (error) {
      console.error('[NATIVE-ADDON] Error stopping monitoring:', error);
    }
  }

  getCurrentSelection() {
    try {
      return this.monitor.getCurrentSelection();
    } catch (error) {
      console.error('[NATIVE-ADDON] Error getting current selection:', error);
      return null;
    }
  }

  onSelection(callback) {
    if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
  }

  notifyCallbacks(payload) {
    this.callbacks.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[NATIVE-ADDON] Error in callback:', error);
      }
    });
  }

  getWordAtPoint(x, y) {
    try {
      if (!this.monitor || typeof this.monitor.getWordAtPoint !== 'function') {
        return { text: '', x, y };
      }
      const result = this.monitor.getWordAtPoint(x, y);
      return result || { text: '', x, y };
    } catch (error) {
      console.error('[NATIVE-ADDON] Error getWordAtPoint:', error);
      return { text: '', x, y };
    }
  }

  isTrusted(prompt = false) {
    if (!this.monitor || typeof this.monitor.isTrusted !== 'function') {
      return process.platform !== 'darwin';
    }
    try {
      return !!this.monitor.isTrusted(prompt);
    } catch (error) {
      return false;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      platform: process.platform,
      method: this.method,
      callbacksCount: this.callbacks.length,
      binding: path.basename(
        process.platform === 'darwin'
          ? 'ax_selection_monitor.node'
          : 'uiautomation_selection_monitor.node',
      ),
    };
  }
}

module.exports = NativeSelectionMonitor;
