import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import DemoPage from './components/DemoPage';

const rootElement = document.getElementById('demo-root');
if (!rootElement) throw new Error('Could not find demo-root element');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <DemoPage />
  </React.StrictMode>
);
