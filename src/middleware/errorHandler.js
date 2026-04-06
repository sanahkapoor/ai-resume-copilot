function notFound(req, res, next) {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(err, req, res, next) {
  const statusCode =
    err?.name === "MulterError"
      ? 400
      : err?.statusCode || err?.status || 500;

  const message = err?.message || "Server error";

  res.status(statusCode).json({
    error: message,
  });
}

module.exports = {
  notFound,
  errorHandler,
};
