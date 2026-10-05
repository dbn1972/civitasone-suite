export const FONT_SHA256: Record<string, string | null>;
export const sha256Hex: (bytes: Uint8Array) => string;
export class FontDigestError extends Error {}
export function verifyAndInstall(dir: string, name: string, bytes: Uint8Array, pins?: Record<string, string | null>): Promise<string>;
