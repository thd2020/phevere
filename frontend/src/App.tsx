import { useState, useEffect } from 'react';
import { Button, Typography, Container } from '@mui/material';

interface LookupResult {
  word: string;
  definition: string;
}

function App() {
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  useEffect(() => {
    // Listen for lookup results
    window.electronAPI.onLookupResult((result) => {
      console.log('Received lookup result:', result);
      setLookupResult(result);
    });

    // Detect text selection (for pop-up)
    document.addEventListener('mouseup', () => {
      let selected = window.getSelection()
      if (selected != null) {
        const selectedText = selected.toString().trim();
        if (selectedText.length > 0) {
          window.electronAPI.showPopup(selectedText);
        }
      }
    });
  }, []);

  return (
    <Container style={{ marginTop: '2rem' }}>
      <Typography variant="h4">Phevere Dictionary</Typography>
      <Typography>Select any text, and a pop-up will appear with its meaning.</Typography>
      {lookupResult && (
        <div style={{ marginTop: '2rem' }}>
          <Typography variant="h6">{lookupResult.word}</Typography>
          <Typography variant="body1">{lookupResult.definition}</Typography>
        </div>
      )}
    </Container>
  );
}

export default App;