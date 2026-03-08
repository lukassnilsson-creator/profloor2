import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminPage from './components/AdminPage';

const rootElement = document.getElementById('admin-root');
if (!rootElement) throw new Error('Could not find admin-root element');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AdminPage />
  </React.StrictMode>
);
