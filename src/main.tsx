import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { cleanRefreshParam } from './lib/refresh';
import { installDemoBridge, autostartDemo } from './lib/field/demoBridge';
import './styles.css';

cleanRefreshParam();
if (installDemoBridge()) autostartDemo(); // bare på siden «Android-app» (android-demo.html), ikke i vanlig bruk

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fullPage>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
