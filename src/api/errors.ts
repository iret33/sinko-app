// The error every request to a box rejects with (src/api/client.ts, src/api/hosts.ts).

/**
 * app.js ApiError (line 427): `status` is the HTTP status (0 = the box did not answer: no connection, a timeout, an answer cut off), `message`
 * is for people, `body` the parsed answer ({} when it was not JSON), so callers can read body.error.message and body.session.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body === undefined ? {} : body;
  }
}
