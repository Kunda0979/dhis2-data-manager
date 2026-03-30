/**
 * Global error handling middleware.
 */
function errorHandler(err, req, res, next) {
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[Error]', err.message);

  // Axios errors from DHIS2
  if (err.response) {
    const status = err.response.status || 500;
    const data = err.response.data;
    return res.status(status).json({
      error: 'DHIS2 API Error',
      status,
      message: typeof data === 'string' ? data : data?.message || JSON.stringify(data),
      details: isProd ? undefined : data,
    });
  }

  // Custom errors
  if (err.status) {
    return res.status(err.status).json({
      error: err.message,
    });
  }

  // Generic server error
  res.status(500).json({
    error: 'Internal Server Error',
    message: isProd ? 'Unexpected server error' : err.message,
  });
}

module.exports = errorHandler;
