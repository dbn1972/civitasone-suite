/**
 * Production OcrPipelinePort: @civitasone/ocr end to end.
 *   processDocument (rasterise + preprocess + provider chain) -> detectPii -> extractFields -> classify
 *   -> toPlainText / toStructuredJson (PII masked per tenant policy) -> buildSearchablePdf.
 *
 * Loaded lazily by ports.ts so the HTTP process never imports tesseract / pdf / sharp.
 * Chains (and their tesseract worker pools) are cached per provider-chain configuration and disposed on
 * shutdown (disposeOcrAdapter). Raw PII never leaves this function: every output is already masked, and
 * thrown error messages are scrubbed with the package's scrubString.
 */
import {
  OcrChain, OcrInputError, createProvider, processDocument, classifyDetailed, classifyWithPreset, extractFields, detectPiiInPages,
  toPlainText, toStructuredJson, buildSearchablePdf, redactImage, scrubString, disposeDefaultOrientationDetector,
  DEFAULT_CLASSIFIER_CONFIG,
  type ChainProviderConfig, type ClassifierConfig, type ClassifierTypeRule, type OcrProvider, type PageImage, type PreprocessConfig,
} from "@civitasone/ocr";
import { refinePreset } from "./classify-preset.js";
import { OcrStepError, type OcrPipelineInput, type OcrPipelineOutput, type OcrPipelinePort } from "./ocr-port.js";
import type { BulkScanSettings, PreprocessStep } from "./validators.js";

type Settings = OcrPipelineInput["settings"];

/**
 * Cloud OCR mode. "sandbox" (fake / test endpoints) is only honoured in an explicit development / test environment: an
 * unset or any other NODE_ENV refuses it, so a stray BULK_SCAN_OCR_CLOUD_MODE=sandbox can never route real scans to a sandbox.
 */
export const cloudMode = (): "sandbox" | "production" => {
  if (process.env.BULK_SCAN_OCR_CLOUD_MODE !== "sandbox") return "production";
  if (!["development", "test"].includes(process.env.NODE_ENV ?? "")) {
    throw new OcrStepError("CLOUD_MODE_NOT_ALLOWED", "BULK_SCAN_OCR_CLOUD_MODE=sandbox is refused outside NODE_ENV development/test", false);
  }
  return "sandbox";
};
const MAX_PAGES = Number(process.env.BULK_SCAN_MAX_PAGES ?? 200);
const TESS_WORKERS = Number(process.env.BULK_SCAN_TESSERACT_WORKERS ?? 2);

interface CachedChain { chain: OcrChain; providers: OcrProvider[] }
const chains = new Map<string, CachedChain>();

function chainFor(s: Settings): OcrChain {
  const key = JSON.stringify([s.providerChain, s.languages, s.bestOf]);
  const hit = chains.get(key);
  if (hit) return hit.chain;
  const providers: OcrProvider[] = [];
  const cfgs: ChainProviderConfig[] = s.providerChain.map((p) => {
    const provider = p.id === "tesseract"
      ? createProvider({ id: "tesseract", tesseract: { maxWorkers: TESS_WORKERS } })
      : createProvider({ id: p.id, cloud: { mode: cloudMode() } });
    providers.push(provider);
    return { provider, timeoutMs: p.timeoutMs };
  });
  const chain = new OcrChain({ providers: cfgs, langs: s.languages, bestOf: s.bestOf });
  if (chains.size >= 4) {                       // tiny LRU: drop (and dispose) the oldest configuration
    const oldest = chains.keys().next().value as string | undefined;
    if (oldest) { const old = chains.get(oldest); chains.delete(oldest); void Promise.all((old?.providers ?? []).map((pr) => pr.dispose())); }
  }
  chains.set(key, { chain, providers });
  return chain;
}

export async function disposeOcrAdapter(): Promise<void> {
  const all = [...chains.values()];
  chains.clear();
  await Promise.all(all.flatMap((c) => c.providers.map((p) => p.dispose())));
  await disposeDefaultOrientationDetector();
}

/** Map the tenant's preprocessing step list onto the package's boolean config. */
export function preprocessConfig(steps: readonly PreprocessStep[], dpi: number): Partial<PreprocessConfig> {
  const on = new Set(steps);
  return {
    dpi, autoOrient: on.has("rotate"), deskew: on.has("deskew"), grayscale: on.has("grayscale"),
    normalise: on.has("contrast"), denoise: on.has("denoise"), binarise: on.has("binarize"), cropBorder: on.has("crop"),
  };
}

/** Tenant doc types layered over the package's richer default rules (tenant keywords are ADDED to defaults). */
export function classifierConfigFor(s: Pick<BulkScanSettings, "classification">): ClassifierConfig {
  const defaults = new Map<string, ClassifierTypeRule>(DEFAULT_CLASSIFIER_CONFIG.types.map((t) => [t.id, t]));
  const types: ClassifierTypeRule[] = s.classification.docTypes.map((d) => {
    const base = defaults.get(d.id);
    const extra = d.keywords.map((term) => ({ term, weight: 2 }));
    return base
      ? { ...base, label: d.label, keywords: [...base.keywords, ...extra] }
      : { id: d.id, label: d.label, keywords: extra, minScore: 2 };
  });
  return { ...DEFAULT_CLASSIFIER_CONFIG, types, minConfidence: s.classification.uncertainBelow, uncertainMargin: s.classification.uncertainMargin, fallbackType: "other" };
}

export function createOcrAdapter(): OcrPipelinePort {
  return {
    async run(input: OcrPipelineInput): Promise<OcrPipelineOutput> {
      const s = input.settings;
      const degraded: string[] = [];
      try {
        const processed = await processDocument(
          { data: input.bytes, mimeType: input.mimeType },
          {
            chain: chainFor(s), preprocess: preprocessConfig(s.preprocessingSteps, s.dpi), maxPages: MAX_PAGES,
            ...(input.signal ? { signal: input.signal } : {}),
          },
        );
        const result = processed.result;
        const policy = s.pii.policy;
        const pii = detectPiiInPages(result.pages, policy);
        const fields = extractFields(result.pages, { policy, twoDigitYearPivot: s.twoDigitYearPivot });
        const clsCfg = classifierConfigFor(s);
        const classification = refinePreset(
          classifyWithPreset(result.pages, clsCfg, input.presetDocType, { fields }),
          classifyDetailed(result.pages, clsCfg, { fields }).classification.confidence,
          s.classification.minScore,
        );
        const maskedText = toPlainText(result, pii);
        const structuredJson = toStructuredJson(result, { fields, classification, pii, metadata: { fileId: input.fileId } });

        // Searchable PDF: redact-action findings are burned into the page images first. If any cannot be located
        // we OMIT the PDF (never publish an unredacted copy) and flag it so the file goes to review.
        let searchablePdf: Uint8Array | null = null;
        let degradedPages: NonNullable<OcrPipelineOutput["degradedPages"]> = [];
        let pageImages: OcrPipelineOutput["pageImages"];
        try {
          let unlocatable = 0;
          const pages: PageImage[] = [];
          for (const img of processed.pages) {
            if (pii.some((f) => f.action === "redact" && f.pageNumber === img.pageNumber)) {
              const r = await redactImage(img.data, pii, { pageNumber: img.pageNumber });
              unlocatable += r.unlocatable;
              pages.push({ ...img, data: r.data, mimeType: "image/png" });
            } else pages.push(img);
          }
          if (unlocatable > 0) degraded.push("PDF_OMITTED_UNREDACTABLE_PII");
          else {
            const built = await buildSearchablePdf(pages, result.pages, { pii });
            searchablePdf = built.pdf;
            degradedPages = built.degradedPages.map((d) => ({ pageNumber: d.pageNumber, reason: d.reason, droppedScripts: d.droppedScripts.map(String) }));
            pageImages = pages.map((img) => ({ pageNumber: img.pageNumber, data: img.data, mimeType: img.mimeType, width: img.width, height: img.height }));
          }
        } catch {
          degraded.push("PDF_BUILD_FAILED");
        }

        return {
          pageCount: result.pageCount, meanConfidence: result.meanConfidence, providerIds: [...result.providerIds],
          maskedText, structuredJson, searchablePdf, classification, fields, piiFindings: pii, degraded, degradedPages,
          ...(pageImages ? { pageImages } : {}),
        };
      } catch (e) {
        if (e instanceof OcrStepError) throw e;
        const msg = scrubString(e instanceof Error ? e.message : String(e)).slice(0, 300);
        if (e instanceof OcrInputError) {
          const code = e.code === "UNSUPPORTED_TYPE" ? "UNSUPPORTED_TYPE" : e.code;   // ENCRYPTED_PDF | CORRUPT | TOO_MANY_PAGES
          throw new OcrStepError(code, msg, false);
        }
        throw new OcrStepError("OCR_FAILED", msg, true);
      }
    },
  };
}
