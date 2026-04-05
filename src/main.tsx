import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import 'lalo-verify/styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const resetFlag = 'im_in_service_worker_reset_v1';

    navigator.serviceWorker.getRegistrations()
      .then(async (registrations) => {
        if (registrations.length === 0) {
          window.sessionStorage.removeItem(resetFlag);
          return;
        }

        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
          const cacheKeys = await window.caches.keys();
          await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
        }

        if (navigator.serviceWorker.controller && !window.sessionStorage.getItem(resetFlag)) {
          window.sessionStorage.setItem(resetFlag, '1');
          window.location.reload();
          return;
        }

        window.sessionStorage.removeItem(resetFlag);
      })
      .catch((error) => {
        console.error('Service worker cleanup failed:', error);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
