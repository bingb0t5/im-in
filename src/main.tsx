import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './generated/lalo-verify/styles.css';
import { initProductAnalytics } from './lib/productAnalytics';
import { registerAppServiceWorker } from './lib/serviceWorker';
import { initTrafficAnalytics } from './lib/trafficAnalytics';

void registerAppServiceWorker();
initProductAnalytics();
initTrafficAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
