import React from 'react';
import './ErrorMessage.css';

function ErrorMessage({ message, onRetry, retryText = 'Retry' }) {
  return (
    <div className="error-message">
      <div className="error-icon">⚠️</div>
      <p className="error-text">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="error-retry-button">
          {retryText}
        </button>
      )}
    </div>
  );
}

export default ErrorMessage;




