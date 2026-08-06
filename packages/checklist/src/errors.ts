/**
 * Domain-level error. Deliberately NOT an HTTP error: this package knows nothing
 * about Fastify, so callers map `code` onto a status themselves.
 */
export class ChecklistDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChecklistDomainError";
  }
}
