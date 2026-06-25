/**
 * Domain-layer error shared across inventory modules. Thrown inside consumers
 * (the write path) when a business rule is violated. The worker logs these and
 * the message is left for redelivery/dead-lettering by the bus.
 */
export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}
