/**
 * Async Error Handler Wrapper
 * Wraps async route handlers to catch errors and pass them to Express error middleware
 * Eliminates the need for try/catch in every route
 * 
 * Usage:
 *   router.get('/route', asyncHandler(async (req, res) => {
 *     const data = await someAsyncFunction();
 *     res.json(data);
 *   }));
 */

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;

