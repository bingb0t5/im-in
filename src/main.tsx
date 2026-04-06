import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './vendor/lalo-verify/styles.css';
import { registerAppServiceWorker } from './lib/serviceWorker';

void registerAppServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
