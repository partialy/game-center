import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { MobileViewportProvider } from './platform/mobile/MobileViewportContext';
import { ThemeProvider } from './platform/theme/ThemeContext';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <MobileViewportProvider>
      <App />
    </MobileViewportProvider>
  </ThemeProvider>
);
