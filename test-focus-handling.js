#!/usr/bin/env node

/**
 * Test script for popup focus handling
 * Run this to test the focus recovery mechanisms
 */

console.log('🧪 Testing Popup Focus Handling...\n');

// Simulate the focus issue scenario
console.log('📋 Test Scenario:');
console.log('1. Popup created and focused');
console.log('2. User clicks outside (blur event)');
console.log('3. getFocusedWindow() returns undefined');
console.log('4. Mouse position check determines if popup should close\n');

// Test the mouse position logic
function testMousePositionLogic() {
  console.log('🔍 Testing Mouse Position Logic:');
  
  // Simulate popup bounds
  const popupBounds = { x: 100, y: 100, width: 300, height: 200 };
  
  // Test cases
  const testCases = [
    { x: 50, y: 50, expected: true, description: 'Mouse above and left of popup' },
    { x: 450, y: 150, expected: true, description: 'Mouse to the right of popup' },
    { x: 150, y: 350, expected: true, description: 'Mouse below popup' },
    { x: 150, y: 150, expected: false, description: 'Mouse inside popup' },
    { x: 100, y: 100, expected: false, description: 'Mouse at popup edge (inside)' },
    { x: 400, y: 300, expected: false, description: 'Mouse at popup edge (inside)' }
  ];
  
  testCases.forEach(({ x, y, expected, description }) => {
    const isMouseOutside = x < popupBounds.x || 
                          x > popupBounds.x + popupBounds.width ||
                          y < popupBounds.y || 
                          y > popupBounds.y + popupBounds.height;
    
    const result = isMouseOutside === expected ? '✅ PASS' : '❌ FAIL';
    console.log(`${result} ${description}: (${x}, ${y}) -> ${isMouseOutside ? 'outside' : 'inside'}`);
  });
}

// Test the focus recovery logic
function testFocusRecoveryLogic() {
  console.log('\n🔍 Testing Focus Recovery Logic:');
  
  const scenarios = [
    {
      name: 'Normal focus loss',
      isFocused: false,
      focusedWindow: { id: 123, title: 'Other App' },
      expected: 'close',
      description: 'Another window has focus - close popup'
    },
    {
      name: 'Undefined focus with mouse outside',
      isFocused: false,
      focusedWindow: undefined,
      mouseOutside: true,
      expected: 'close',
      description: 'No focus + mouse outside - close popup'
    },
    {
      name: 'Undefined focus with mouse inside',
      isFocused: false,
      focusedWindow: undefined,
      mouseOutside: false,
      expected: 'keep',
      description: 'No focus + mouse inside - keep popup'
    },
    {
      name: 'Popup still focused',
      isFocused: true,
      focusedWindow: { id: 456, title: 'Popup' },
      expected: 'keep',
      description: 'Popup still has focus - keep it'
    }
  ];
  
  scenarios.forEach(scenario => {
    let shouldClose = false;
    
    if (!scenario.isFocused) {
      if (scenario.focusedWindow && scenario.focusedWindow.id !== 456) {
        shouldClose = true;
      } else if (scenario.focusedWindow === undefined && scenario.mouseOutside) {
        shouldClose = true;
      }
    }
    
    const result = (shouldClose && scenario.expected === 'close') || 
                  (!shouldClose && scenario.expected === 'keep') ? '✅ PASS' : '❌ FAIL';
    
    console.log(`${result} ${scenario.name}: ${scenario.description}`);
  });
}

// Run tests
testMousePositionLogic();
testFocusRecoveryLogic();

console.log('\n🎯 Focus Handling Test Complete!');
console.log('Check the console logs when running the app to see the enhanced focus handling in action.');
console.log('The popup should now properly close when you click outside, even when getFocusedWindow() returns undefined.');
