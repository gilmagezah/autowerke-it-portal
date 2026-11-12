// Express 4 doesn't notice when an async route handler rejects: the request hangs, and on
// Node 15+ the unhandled rejection stops the whole process. One bad request could take the
// site down. This makes every handler's rejected promise go to next(err), so the normal error
// handler answers (a generic message, never details), the way Express 5 does out of the box.
// It must be loaded before any route is registered (first thing in server.js).

const Layer = require('express/lib/router/layer');

if (!Layer.prototype.__asyncErrorsPatched) {
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // error handlers are called through handle_error instead
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === 'function') out.then(undefined, (err) => next(err || new Error('Request failed')));
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.__asyncErrorsPatched = true;
}

// Last line of defence: anything rejected outside a request (timers, background jobs) is
// logged, not fatal. Only the message: never request bodies, codes or tokens.
function installProcessHandlers() {
  if (process.listenerCount('unhandledRejection') > 0) return;
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled promise rejection (the app kept running):', err && err.message ? err.message : String(err));
  });
}

module.exports = { installProcessHandlers };
