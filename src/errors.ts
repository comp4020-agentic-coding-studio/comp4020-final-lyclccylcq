// An error the client caused or should know about: the server answers with
// this status and message, and writes nothing.
export class HttpError extends Error {
  status: number;
  details: Record<string, unknown> | undefined;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (message: string): HttpError => new HttpError(400, message);
export const notFound = (message = "Not found."): HttpError => new HttpError(404, message);
