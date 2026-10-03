import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import { captureInvite } from './lib/invite.js';
import './styles.css';

captureInvite();

// Installable app + offline shell (production only; dev uses live reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
);
