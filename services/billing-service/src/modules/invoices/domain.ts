export function shouldSkipInvoiceGeneration(govtExempt: boolean): boolean {
  return govtExempt;
}

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}
