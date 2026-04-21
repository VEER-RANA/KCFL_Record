import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { GlobalLoadingProvider } from './lib/loading';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <GlobalLoadingProvider>
        <App />
      </GlobalLoadingProvider>
    </BrowserRouter>
  </React.StrictMode>
);
