export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertLatLonValid(lat: number, lon: number): void {
  if (lat < -90 || lat > 90) {
    throw new DomainError("INVALID_LAT", `latitude must be -90 to 90, got ${lat}`);
  }
  if (lon < -180 || lon > 180) {
    throw new DomainError("INVALID_LON", `longitude must be -180 to 180, got ${lon}`);
  }
}
