/**
 * Sanitizes error objects to prevent leaking sensitive information in logs.
 * Specifically handles Axios errors and Prisma errors to redact sensitive fields.
 */
export function sanitizeError(err: any): any {
  if (!err) return err;

  if (typeof err !== 'object') return err;

  const sanitized: any = {
    message: err.message,
    name: err.name,
    stack: err.stack,
  };

  // Handle Axios errors
  if (err.isAxiosError || err.config) {
    sanitized.url = err.config?.url;
    sanitized.method = err.config?.method;
    sanitized.status = err.response?.status;
    sanitized.statusText = err.response?.statusText;
    sanitized.code = err.code;
    // Explicitly exclude request/response headers and bodies which may contain sensitive data
  }

  // Handle Prisma errors
  if (err.code && (err.clientVersion || err.meta)) {
    sanitized.code = err.code;
    sanitized.meta = err.meta;
  }

  return sanitized;
}
