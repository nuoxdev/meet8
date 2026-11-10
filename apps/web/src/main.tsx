import React from 'react';
import { createRoot } from 'react-dom/client';
import '@livekit/components-styles';
import './styles.css';
import './rtl.css';
import { LanguageProvider } from './i18n';
import { App } from './App';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
