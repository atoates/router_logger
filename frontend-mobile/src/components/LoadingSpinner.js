import React from 'react';
import './LoadingSpinner.css';

function LoadingSpinner({ size = 'medium', text = '' }) {
  return (
    <div className="loading-spinner-container">
      <div className={`loading-spinner loading-spinner-${size}`}></div>
      {text && <p className="loading-text">{text}</p>}
    </div>
  );
}

export default LoadingSpinner;




