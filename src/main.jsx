import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import UpdateBanner from './components/UpdateBanner.jsx';
import { captureInvite } from './lib/invite.js';
import { pageForPath } from './lib/route.js';
import './styles.css';

const page = pageForPath(location.pathname);
// Loading the public shop never evaluates App or its Firebase/session imports.
const Page = lazy(page === 'merch' ? () => import('./pages/Merch.jsx') : () => import('./App.jsx'));
document.title = page === 'merch' ? 'Dot by Baseline — Coming soon' : 'Baseline';
if (page === 'app') captureInvite();

// Installable app + offline shell (production only; dev uses live reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div role="status" style={{ padding: '2rem' }}>Loading…</div>}>
      <Page />
    </Suspense>
    {page === 'app' && <UpdateBanner />}
  </StrictMode>,
);
