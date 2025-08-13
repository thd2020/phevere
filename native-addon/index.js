const { UIAutomationSelectionMonitor } = require('./build/Release/uiautomation_selection_monitor.node');

class NativeSelectionMonitor {
  constructor() {
    this.monitor = new UIAutomationSelectionMonitor();
    this.isRunning = false;
    this.callbacks = [];
  }

  /**
   * Start monitoring for text selections using UIA
   */
  start() {
    if (this.isRunning) {
      console.log('[UIA-ADDON] Already running');
      return false;
    }

    try {
      // Set up the callback
      this.monitor.setCallback((text, x, y) => {
        console.log(`[UIA-ADDON] Selection detected: "${text}" @ (${x}, ${y})`);
        this.notifyCallbacks({ text, x, y });
      });

      // Start monitoring
      const result = this.monitor.start();
      if (result) {
        this.isRunning = true;
        console.log('[UIA-ADDON] UIA selection monitoring started');
        return true;
      } else {
        console.error('[UIA-ADDON] Failed to start UIA monitoring');
        return false;
      }
    } catch (error) {
      console.error('[UIA-ADDON] Error starting UIA monitoring:', error);
      return false;
    }
  }

  /**
   * Stop monitoring for text selections
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      this.monitor.stop();
      this.isRunning = false;
      console.log('[UIA-ADDON] UIA selection monitoring stopped');
    } catch (error) {
      console.error('[UIA-ADDON] Error stopping UIA monitoring:', error);
    }
  }

  /**
   * Get the current selection
   */
  getCurrentSelection() {
    try {
      return this.monitor.getCurrentSelection();
    } catch (error) {
      console.error('[UIA-ADDON] Error getting current selection:', error);
      return null;
    }
  }

  /**
   * Register a callback for selection events
   */
  onSelection(callback) {
    if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
  }

  /**
   * Notify all registered callbacks
   */
  notifyCallbacks(payload) {
    this.callbacks.forEach(callback => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[UIA-ADDON] Error in callback:', error);
      }
    });
  }

  /**
   * Get the status of the monitor
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      platform: process.platform,
      method: 'uiautomation',
      callbacksCount: this.callbacks.length
    };
  }
}

module.exports = NativeSelectionMonitor; 