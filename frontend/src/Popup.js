import React, { useState, useEffect } from 'react';
import { Card, CardContent, Typography } from '@mui/material';

function Popup() {
  const [lookupResult, setLookupResult] = useState(null);

  useEffect(() => {
    window.electronAPI.onLookupResult((result) => {
    setLookupResult(result);
    });
  }, []);

  return (
    <Card style={{ padding: '10px', width: '250px' }}>
      <CardContent>
        {lookupResult ? (
          <>
            <Typography variant="h6">{lookupResult.word}</Typography>
            <Typography variant="body2">{lookupResult.definition}</Typography>
          </>
        ) : (
          <Typography variant="body2">Select text to see the meaning.</Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default Popup;