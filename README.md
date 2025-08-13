# 📚 Phevere Dictionary

A cross-platform dictionary application that triggers on **pure native text selection**, built with Electron and Microsoft UI Automation.

## 🎯 Project Overview

Phevere is designed to provide instant dictionary lookups when you **select text anywhere on your screen** - **no copying, no additional keys, just pure selection**. It supports multiple languages with a focus on Chinese ↔ English translations.

### 🎯 **Core Goal: Pure Native Text Selection**
- **Select any text** - Just drag your mouse to select text
- **Automatic popup** - Dictionary results appear immediately
- **No additional actions** - No Ctrl+C, no buttons, no manual triggers
- **Real native hooks** - Uses Microsoft UI Automation with intelligent debouncing

### Key Features (Current Focus)

- **🔍 Pure Text Selection Detection**: Microsoft UI Automation with 500ms debouncing (like Youdao Dictionary)
- **📚 Multi-language Support**: Chinese ↔ English translations with pronunciation
- **🎨 Rich Dictionary Results**: Definitions, examples, translations
- **🌐 Wikipedia Integration**: Quick access to Wikipedia entries
- **🔍 Google Search**: Related search results
- **📋 Clipboard History**: Automatic clipboard monitoring and history management

## 🚀 **NEW: AI-Enhanced Popup Interface**

### **🎨 Modern Collapsible Toolbar Design**
- **Eliminated margins** - Content goes to the edge for maximum space utilization
- **Collapsible toolbar** - Only icons visible by default, expandable on click
- **Separate dictionary and translation icons** - Clear distinction between functions
- **Pre-loading content** - Dictionary content loads even when collapsed for consistency

### **⚙️ User-Configurable Behavior**
- **Expandable toolbar mode** - Choose between compact toolbar or full view
- **Preload settings** - Control whether content loads before expansion
- **Persistent preferences** - Settings saved in localStorage

### **🎯 Enhanced User Experience**
- **Smooth animations** - Professional-grade transitions and effects
- **Intuitive navigation** - Clear icon-based interface
- **Responsive design** - Adapts to different screen sizes
- **Keyboard shortcuts** - Escape key for quick navigation

### **🔧 Technical Improvements**
- **Modern CSS architecture** - Clean, maintainable styling
- **Performance optimized** - Efficient rendering and animations
- **Cross-platform compatibility** - Works on Windows, macOS, and Linux
- **Accessibility features** - Keyboard navigation and screen reader support

## 🏗️ Architecture

### **Current Implementation Status**

#### ✅ **Working Components:**
- **Electron UI** - Modern popup and main window
- **Dictionary API** - Google Translate integration
- **Wikipedia API** - Article summaries and search
- **Clipboard History** - Comprehensive clipboard management
- **Global Shortcuts** - Keyboard shortcuts for testing
- **UIAutomation Selection** - Real native text selection detection with debouncing

#### ✅ **Recently Fixed:**
- **Native Selection Hooks** - Microsoft UI Automation implementation working
- **Pure Selection Detection** - Direct UIAutomation events (no indirect methods)
- **Real Selection Events** - System-level selection monitoring with message loop

### **Current Architecture: Pure Native Selection**

```
Text Selection → UIAutomation Event → 500ms Debounce → Electron → Popup
```

**Features:**
- **Event-driven detection** - No polling, pure event-based
- **Intelligent debouncing** - Waits for user to pause selection (500ms)
- **Cross-application support** - Works in any UIA-compliant application
- **Native C++ implementation** - High-performance UIAutomation monitoring

## 🚀 Current Status

### ✅ **Completed & Working**
- [x] **Electron Application** - Full UI and popup system
- [x] **Dictionary API Integration** - Google Translate with fallbacks
- [x] **Wikipedia Integration** - Article search and summaries
- [x] **Clipboard History System** - Complete clipboard management
- [x] **Global Shortcuts** - Testing and manual triggers
- [x] **Modern UI** - Responsive design with rich results
- [x] **UIAutomation Selection** - Real native text selection detection
- [x] **Debounced Detection** - 500ms delay prevents spam (like Youdao Dictionary)
- [x] **Cross-language Support** - Chinese, English, and other languages

### 🚧 **In Progress - Enhanced Features**
- [ ] **OCR functionality** - For non-selectable text
- [ ] **Advanced language detection** - Automatic language identification
- [ ] **User preferences** - Customizable debounce delay and settings
- [ ] **Performance optimizations** - Memory and CPU usage improvements

### ✅ **Recently Resolved**
- **UIAutomation Implementation** - Working with proper message loop
- **Debounced Selection** - Intelligent waiting for user to pause
- **Cross-application Support** - Works in Notepad, Word, browsers, etc.
- **Administrator Privileges** - Proper privilege handling for system-wide monitoring

## 🎯 **Current Features**

### **Phase 1: Pure Native Selection (✅ Complete)**
1. **Microsoft UI Automation** - Real system-level selection event monitoring
2. **Debounced Detection** - 500ms delay prevents word-by-word spam
3. **Cross-application Support** - Works in any UIA-compliant application
4. **Native C++ Implementation** - High-performance UIAutomation monitoring

### **Phase 2: Enhanced Features (🚧 In Progress)**
- [ ] OCR functionality for non-selectable text
- [ ] Advanced language detection
- [ ] User preferences and customization
- [ ] Performance optimizations

## 🛠️ Development Setup

### Prerequisites
- Node.js (v16 or higher)
- Visual Studio 2022 (for native addon compilation)
- Windows 10/11 (for UIAutomation support)

### Installation

#### Windows (✅ Working)
```bash
# Clone the repository
git clone <repository-url>
cd phevere

# Install dependencies
npm install

# Build native addon
npm run build

# Start the application
npm start
```

### **Important Notes:**
- **Administrator Privileges**: The application requires administrator privileges for system-wide UIAutomation monitoring
- **UIA-compliant Applications**: Works best with applications that support Microsoft UI Automation (Notepad, Word, browsers, etc.)
- **Debounced Behavior**: The system waits 500ms after you stop selecting text before showing the popup (like Youdao Dictionary)
- **Native Implementation**: Uses C++ UIAutomation for high-performance text selection detection

### **Running the Application:**

#### **For UIAutomation Selection Detection (Recommended):**
```bash
# Run with administrator privileges for full UIAutomation support
npm run start-admin
```

#### **For Development Testing:**
```bash
# Run without administrator privileges (limited functionality)
npm start
```

**Note:** Without administrator privileges, UIAutomation selection detection will not work. The application requires elevated privileges for system-wide monitoring. 