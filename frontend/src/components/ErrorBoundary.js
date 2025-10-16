import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ borderColor: '#f56565' }}>
          <h2>Something went wrong</h2>
          <p>We hit an unexpected error while rendering this section.</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fff5f5', padding: '10px', borderRadius: '6px', color: '#c53030' }}>
            {String(this.state.error)}
          </pre>
          <button className="btn btn-secondary" onClick={this.handleRetry}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
