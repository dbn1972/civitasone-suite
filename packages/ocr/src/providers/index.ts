import type { OcrProvider, OcrProviderId } from "../types.js";
import { TesseractProvider, type TesseractProviderConfig } from "./tesseract.js";
import { createCloudProvider, type CloudProviderConfig, type CloudProviderId } from "./cloud.js";

export * from "./tesseract.js";
export * from "./cloud.js";

export type ProviderConfig =
  | { id: "tesseract"; tesseract?: TesseractProviderConfig }
  | { id: CloudProviderId; cloud: CloudProviderConfig };

/** Builds a provider from plain per-tenant config. */
export function createProvider(cfg: ProviderConfig): OcrProvider {
  if (cfg.id === "tesseract") return new TesseractProvider(cfg.tesseract);
  return createCloudProvider(cfg.id, cfg.cloud);
}

export type { OcrProviderId };
