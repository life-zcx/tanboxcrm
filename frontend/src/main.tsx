import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BrowserRouter } from 'react-router-dom';
document.getElementById('root')!.dataset.ready = 'true';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary><BrowserRouter><App /></BrowserRouter></ErrorBoundary>
  </React.StrictMode>
);

