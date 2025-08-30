# 🔍 Popup Focus Issue Analysis & Debugging Tools

## 🚨 **Problem Description**

The popup window sometimes fails to close when clicking outside shortly after creation. This indicates a **race condition** between:

1. **Popup window creation and focus acquisition**
2. **Blur event handling setup**
3. **Window state management**

## 🔬 **Root Cause Analysis**

### **Race Condition Scenario**
```
Timeline:
0ms    - Popup window created
50ms   - Popup shown and focused
60ms   - User clicks outside (blur event)
65ms   - Blur event handler executes
70ms   - Blur close check runs
75ms   - Popup should close but doesn't
```

### **Why This Happens**
1. **Event Handler Setup Timing**: Blur event handlers may not be fully registered when the first blur occurs
2. **Focus State Inconsistency**: The popup's internal focus state may not match the system's focus state
3. **Debouncing Logic**: The 250ms delay in blur handling may interfere with immediate focus loss detection
4. **getFocusedWindow() Returns undefined**: When no window has focus, the blur close logic fails

## 🛠️ **Debugging Tools Added**

### **1. Enhanced Focus Tracking**
- **Comprehensive logging** of all focus/blur events with timestamps
- **Race condition detection** with 100ms minimum lifetime protection
- **Focus state monitoring** for each popup window

### **2. Periodic Focus State Monitoring**
- **5-second intervals** to monitor all active popups
- **Real-time focus status** reporting
- **Window age tracking** to identify stuck popups

### **3. Debug Interface**
- **🐛 Debug Button**: Shows current focus state and popup information
- **🧪 Test Function**: Creates test popup to reproduce the issue
- **Force Close**: Ctrl+Click close button to force close stuck popups

### **4. Enhanced Blur Handling**
- **Race condition protection**: Prevents blur-based closure for popups < 100ms old
- **Multiple focus checks**: Verifies focus state before closing
- **Increased blur delay**: 250ms instead of immediate closure

## 🔧 **Focus Handling Fixes Implemented**

### **1. Enhanced Focus Detection**
- **Multiple fallback mechanisms** when `getFocusedWindow()` returns undefined
- **Mouse position checking** to determine if user clicked outside popup bounds
- **Aggressive focus recovery** for stuck popups

### **2. Focus Recovery Mechanisms**
- **Retry focus attempts** with exponential backoff
- **Periodic focus checking** every second to detect lost focus
- **Automatic cleanup** of stuck popups after 5 seconds

### **3. Mouse Position Fallback**
```typescript
// When getFocusedWindow() returns undefined, check mouse position
const popupBounds = newPopupWindow.getBounds();
const mousePosition = screen.getCursorScreenPoint();

const isMouseOutside = mousePosition.x < popupBounds.x || 
                      mousePosition.x > popupBounds.x + popupBounds.width ||
                      mousePosition.y < popupBounds.y || 
                      mousePosition.y > popupBounds.y + popupBounds.height;

if (isMouseOutside) {
  // User clicked outside - close popup
  newPopupWindow.close();
}
```

## 📊 **Debug Information Available**

### **Focus State Data**
```typescript
{
  isFocused: boolean;
  focusTime: number;
  blurTime: number;
  creationTime: number;
  lastBlurCheck: number;
}
```

### **Popup Debug Info**
```typescript
{
  focusedWindow: number | null;
  popups: Array<{
    index: number;
    id: number;
    isFocused: boolean;
    age: number;
    focusState: FocusState | null;
  }>;
}
```

## 🧪 **Testing the Focus Issue**

### **Manual Reproduction**
1. **Create popup** by selecting text
2. **Immediately click outside** (within 100ms of popup appearing)
3. **Observe behavior**: Popup should not close due to race condition protection
4. **Wait 250ms** then click outside again - popup should close normally

### **Automated Testing**
1. **Click the 🐛 Debug button** in any popup
2. **Choose "Yes"** when asked to test focus issue
3. **Test popup appears** and automatically loses focus after 50ms
4. **Check console logs** for race condition detection

## 🔍 **Debug Commands**

### **From Console (Main Process)**
```typescript
// Check focus state monitoring
console.log('[MAIN-POPUP] Focus state monitoring active');

// Manual focus debug
ipcMain.handle('debug-popup-focus', () => { /* ... */ });

// Force close stuck popups
ipcMain.handle('force-close-popup', (popupId) => { /* ... */ });

// Test focus issue reproduction
ipcMain.handle('test-focus-issue', () => { /* ... */ });
```

### **From Renderer Process**
```typescript
// Debug popup focus
const focusInfo = await window.electronAPI.debugPopupFocus();

// Force close popup
const result = await window.electronAPI.forceClosePopup(popupId);

// Test focus issue
const testResult = await window.electronAPI.testFocusIssue();
```

## 📝 **Log Analysis**

### **Key Log Patterns to Watch**

#### **Race Condition Detection**
```
[MAIN-POPUP] ⚠️ RACE CONDITION DETECTED - Popup too young (45ms < 100ms), deferring blur close
```

#### **Focus State Changes**
```
[MAIN-POPUP] 🎯 FOCUS GAINED - Popup focused after 52ms from creation
[MAIN-POPUP] 🔴 BLUR EVENT - Popup lost focus after 67ms from creation
```

#### **Enhanced Blur Close Logic**
```
[MAIN-POPUP] 🔍 BLUR CLOSE CHECK - Focused window: undefined
[MAIN-POPUP] ⚠️ No window has focus - checking popup state
[MAIN-POPUP] ✅ Mouse outside popup bounds, closing popup
```

#### **Focus Recovery**
```
[MAIN-POPUP] 🚨 STUCK POPUP DETECTED - attempting recovery
[MAIN-POPUP] ✅ Focus recovery successful
```

## 🎯 **Expected Behavior After Fixes**

### **Normal Operation**
1. **Popup appears** and gains focus
2. **User clicks outside** → blur event fires
3. **250ms delay** → blur close check runs
4. **Popup closes** if not focused

### **Race Condition Protection**
1. **Popup appears** and gains focus
2. **User immediately clicks outside** (< 100ms)
3. **Race condition detected** → blur close deferred
4. **User clicks outside again** → normal blur close logic applies

### **Undefined Focus Recovery**
1. **Popup loses focus** → `getFocusedWindow()` returns undefined
2. **Mouse position check** → determines if user clicked outside
3. **Popup closes** if mouse is outside bounds
4. **Popup stays open** if mouse is inside bounds

## 🚀 **Next Steps**

### **Immediate Actions**
1. **Test the debugging tools** to reproduce the issue
2. **Monitor console logs** during focus loss scenarios
3. **Use test function** to verify race condition protection
4. **Run test script** to verify focus handling logic

### **Long-term Improvements**
1. **Reduce race condition window** from 100ms to 50ms
2. **Add focus state validation** before blur handling
3. **Implement focus recovery** mechanisms for stuck popups
4. **Add user preference** for blur close delay

## 🔧 **Configuration Options**

### **Adjustable Parameters**
```typescript
// Race condition protection threshold
const minLifetime = 100; // milliseconds

// Blur close delay
const blurCloseDelay = 250; // milliseconds

// Focus monitoring interval
const focusMonitorInterval = 5000; // milliseconds

// Focus recovery timeout
const focusRecoveryTimeout = 5000; // milliseconds
```

### **Environment Variables**
```bash
# Enable detailed UIAutomation logging
PHEVERE_DEBUG_UIA=1

# Enable focus debugging
PHEVERE_DEBUG_FOCUS=1
```

## 🧪 **Testing Tools**

### **Test Script**
Run `node test-focus-handling.js` to verify the focus handling logic:
```bash
node test-focus-handling.js
```

### **Debug Button**
Use the 🐛 debug button in any popup to:
- Check current focus state
- Test focus issue reproduction
- Force close stuck popups

---

**Note**: The focus handling has been significantly improved with multiple fallback mechanisms. The popup should now properly close when you click outside, even when `getFocusedWindow()` returns undefined. The mouse position fallback ensures reliable popup closure behavior.
