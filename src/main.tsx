import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { MobileViewportProvider } from './platform/mobile/MobileViewportContext';

createRoot(document.getElementById('root')!).render(
  <MobileViewportProvider>
    <App />
  </MobileViewportProvider>
);
