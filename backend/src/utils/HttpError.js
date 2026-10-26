/**
 * An error with an HTTP status code that is safe to expose to API clients.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }

  static notFound(message = 'Resource not found') {
    return new HttpError(404, message);
  }
}
