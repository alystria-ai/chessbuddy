import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeTheme } from './theme';
import './styles.css';
import './themes.css';
import './theme-layouts.css';
import './premium-layouts.css';
import './japanese-refinement.css';
import './adaptive-layout.css';
import './game-ready.css';
import './analysis-polish.css';

initializeTheme(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
