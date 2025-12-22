import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios'; // ✅ Import Axios
import './index.css';
import App from './App';

// =========================================================
// ✅ CRITICAL FIX: ENABLE SESSION COOKIES GLOBALLY
// =========================================================
// Ini memaksa browser mengirim cookie session ke backend
axios.defaults.withCredentials = true; 

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
