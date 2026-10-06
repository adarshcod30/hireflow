import '@fontsource-variable/outfit';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initialTheme } from './theme';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/public.css';
import './styles/console.css';

// Set the theme before the first paint so a returning visitor never sees a flash of the other one.
document.documentElement.dataset.theme = initialTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
