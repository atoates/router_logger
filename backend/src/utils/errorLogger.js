/**
 * Utility to sanitize error objects for logging
 * Prevents huge SSL/TLS data from being logged
 */

/**
 * Extract only relevant error information for logging
 * @param {Error} error - The error object to sanitize
 * @returns {Object} - Sanitized error info
 */
function sanitizeError(error) {
  if (!error) return null;

  const sanitized = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };

  // For Axios errors, include response data but not the full request/response objects
  if (error.response) {
    sanitized.status = error.response.status;
    sanitized.statusText = error.response.statusText;
    sanitized.data = error.response.data;
    sanitized.headers = error.response.headers;
  }

  // For Axios errors, include config but not sensitive data
  if (error.config) {
    sanitized.url = error.config.url;
    sanitized.method = error.config.method;
    sanitized.baseURL = error.config.baseURL;
  }

  // Include error code if available
  if (error.code) {
    sanitized.code = error.code;
  }

  return sanitized;
}

module.exports = { sanitizeError };
