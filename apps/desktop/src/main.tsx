import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppearanceProvider } from './AppearanceProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </AppearanceProvider>
  </React.StrictMode>,
);
