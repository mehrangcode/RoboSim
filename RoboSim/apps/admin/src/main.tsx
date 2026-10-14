import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { initI18n } from './lib/i18n.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const i18n = await initI18n();
createRoot(root).render(
  <StrictMode>
    <App i18n={i18n} />
  </StrictMode>,
);
