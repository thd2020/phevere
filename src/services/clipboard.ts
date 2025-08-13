import { clipboard } from 'electron';

export interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: Date;
  type: 'text' | 'image' | 'file';
}

export class ClipboardService {
  private history: ClipboardEntry[] = [];
  private maxHistorySize: number = 50;
  private isMonitoring: boolean = false;
  private lastClipboardText: string = '';
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(maxHistorySize: number = 50) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Start monitoring clipboard changes
   */
  startMonitoring(): void {
    console.log('[DEBUG] ClipboardService.startMonitoring() called');
    
    if (this.isMonitoring) {
      console.log('[DEBUG] ClipboardService: Already monitoring, returning');
      return;
    }

    console.log('[DEBUG] ClipboardService: Setting isMonitoring = true');
    this.isMonitoring = true;
    
    try {
      this.lastClipboardText = clipboard.readText();
      console.log(`[DEBUG] ClipboardService: Initial clipboard text length=${this.lastClipboardText?.length || 0}`);
    } catch (error) {
      console.error('[ERROR] ClipboardService: Error reading initial clipboard:', error);
    }

    // Check clipboard every 2 seconds
    console.log('[DEBUG] ClipboardService: Setting up interval timer');
    this.checkInterval = setInterval(() => {
      this.checkClipboard();
    }, 2000);

    console.log('[DEBUG] ClipboardService: Clipboard monitoring started successfully');
  }

  /**
   * Stop monitoring clipboard changes
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    console.log('Clipboard monitoring stopped');
  }

  /**
   * Check for clipboard changes
   */
  private checkClipboard(): void {
    try {
      const currentText = clipboard.readText();
      
      // Check if text has changed and is not empty
      if (currentText !== this.lastClipboardText && currentText.trim().length > 0) {
        console.log(`[DEBUG] ClipboardService.checkClipboard: New content detected: "${currentText?.substring(0, 50)}${currentText?.length > 50 ? '...' : ''}"`);
        this.addToHistory(currentText, 'text');
        this.lastClipboardText = currentText;
      }
    } catch (error) {
      console.error('[ERROR] ClipboardService.checkClipboard: Error reading clipboard:', error);
    }
  }

  /**
   * Add an entry to clipboard history
   */
  addToHistory(text: string, type: 'text' | 'image' | 'file' = 'text'): void {
    const entry: ClipboardEntry = {
      id: this.generateId(),
      text: text.trim(),
      timestamp: new Date(),
      type,
    };

    // Add to beginning of history
    this.history.unshift(entry);

    // Remove duplicates (keep the most recent)
    this.history = this.history.filter((item, index, self) => 
      index === self.findIndex(t => t.text === item.text)
    );

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }

    console.log(`Added to clipboard history: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  }

  /**
   * Get clipboard history
   */
  getHistory(): ClipboardEntry[] {
    return [...this.history];
  }

  /**
   * Get recent clipboard entries (last N entries)
   */
  getRecentEntries(count: number = 10): ClipboardEntry[] {
    return this.history.slice(0, count);
  }

  /**
   * Search clipboard history
   */
  searchHistory(query: string): ClipboardEntry[] {
    const lowercaseQuery = query.toLowerCase();
    return this.history.filter(entry => 
      entry.text.toLowerCase().includes(lowercaseQuery)
    );
  }

  /**
   * Clear clipboard history
   */
  clearHistory(): void {
    this.history = [];
    console.log('Clipboard history cleared');
  }

  /**
   * Remove a specific entry from history
   */
  removeEntry(id: string): boolean {
    const initialLength = this.history.length;
    this.history = this.history.filter(entry => entry.id !== id);
    return this.history.length < initialLength;
  }

  /**
   * Copy text to clipboard and add to history
   */
  copyToClipboard(text: string): void {
    try {
      clipboard.writeText(text);
      this.addToHistory(text, 'text');
      console.log(`Copied to clipboard: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  }

  /**
   * Get current clipboard text
   */
  getCurrentClipboardText(): string {
    try {
      const text = clipboard.readText();
      return text;
    } catch (error) {
      console.error('[ERROR] ClipboardService.getCurrentClipboardText: Error reading clipboard:', error);
      return '';
    }
  }

  /**
   * Clear the clipboard
   */
  clearClipboard(): void {
    try {
      clipboard.clear();
      console.log('[DEBUG] Clipboard cleared');
      
      // Verify the clear worked
      setTimeout(() => {
        const text = clipboard.readText();
        if (text && text.trim().length > 0) {
          console.log('[WARNING] Clipboard clear may not have worked, content still present:', text);
        } else {
          console.log('[SUCCESS] Clipboard clear verified - empty');
        }
      }, 100);
    } catch (error) {
      console.error('[ERROR] Error clearing clipboard:', error);
    }
  }

  /**
   * Generate unique ID for clipboard entries
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Get clipboard history statistics
   */
  getStats(): { totalEntries: number; oldestEntry: Date | null; newestEntry: Date | null } {
    if (this.history.length === 0) {
      return { totalEntries: 0, oldestEntry: null, newestEntry: null };
    }

    return {
      totalEntries: this.history.length,
      oldestEntry: this.history[this.history.length - 1].timestamp,
      newestEntry: this.history[0].timestamp,
    };
  }

  /**
   * Export clipboard history as JSON
   */
  exportHistory(): string {
    return JSON.stringify(this.history, null, 2);
  }

  /**
   * Import clipboard history from JSON
   */
  importHistory(jsonData: string): boolean {
    try {
      const importedHistory = JSON.parse(jsonData) as ClipboardEntry[];
      
      // Validate imported data
      if (!Array.isArray(importedHistory)) {
        throw new Error('Invalid data format');
      }

      // Merge with existing history
      this.history = [...this.history, ...importedHistory];
      
      // Remove duplicates and limit size
      this.history = this.history.filter((item, index, self) => 
        index === self.findIndex(t => t.text === item.text)
      );
      
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(0, this.maxHistorySize);
      }

      console.log(`Imported ${importedHistory.length} clipboard entries`);
      return true;
    } catch (error) {
      console.error('Error importing clipboard history:', error);
      return false;
    }
  }
}

// Export singleton instance
export const clipboardService = new ClipboardService(); 