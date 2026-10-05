/**
 * Cloud OCR ports: Google Document AI, AWS Textract, Azure Document Intelligence, Bhashini (GoI).
 *
 * Each is a config-driven class with two modes:
 *  - "sandbox": deterministic mock result derived from the input bytes (same input => same output),
 *    flagged `metadata.sandbox = true` on every page. For tests, demos and UAT wiring.
 *  - "production": NOT IMPLEMENTED. Throws OcrNotImplementedError naming the provider. Real wiring
 *    (endpoints, auth, SDK/protocol) is done in UAT against the contract with each vendor; this file
 *    deliberately invents no endpoints, request shapes or SDK calls.
 */
import { createHash } from "node:crypto";
import { detectScript } from "../script.js";
import {
  OcrNotImplementedError,
  type OcrBlock, type OcrLine, type OcrProvider, type OcrProviderId, type OcrWord,
  type PageImage, type PageResult, type RecognizeOptions,
} from "../types.js";

export interface CloudProviderConfig {
  mode: "sandbox" | "production";
  /**
   * Sandbox mock output (fake text at 0.80-0.97 confidence) must never reach real documents, so "sandbox" is
   * honoured ONLY when NODE_ENV is exactly "development" or "test" (an unset/unknown/"production"/"staging" env
   * behaves as production => OcrNotImplementedError / unavailable). `allowSandbox` is the explicit, code-level
   * override for tests (true forces sandbox on, false forces it off); never wire it to user/tenant config.
   */
  allowSandbox?: boolean;
  /** Opaque, provider-specific settings supplied by platform integration config (never credentials inline). */
  endpoint?: string;
  credentialRef?: string;
  options?: Record<string, string>;
}

export type CloudProviderId = Exclude<OcrProviderId, "tesseract">;

/** True when the sandbox mock may run in this process (explicit flag, else allow-list of dev/test NODE_ENV). */
export function sandboxPermitted(config: Pick<CloudProviderConfig, "allowSandbox">): boolean {
  if (config.allowSandbox !== undefined) return config.allowSandbox;
  return ["development", "test"].includes(process.env.NODE_ENV ?? "");
}

abstract class CloudOcrProvider implements OcrProvider {
  abstract readonly id: CloudProviderId;
  protected abstract readonly label: string;
  constructor(protected readonly config: CloudProviderConfig) {}

  /** Sandbox is always available; an unimplemented production adapter reports unavailable so chains skip it. */
  async isAvailable(): Promise<boolean> { return this.sandboxActive(); }

  private sandboxActive(): boolean { return this.config.mode === "sandbox" && sandboxPermitted(this.config); }

  async recognize(pages: PageImage[], opts: RecognizeOptions): Promise<PageResult[]> {
    if (!this.sandboxActive()) throw new OcrNotImplementedError(this.id);
    return pages.map((p) => this.sandboxPage(p, opts));
  }

  async dispose(): Promise<void> { /* nothing held */ }

  private sandboxPage(page: PageImage, opts: RecognizeOptions): PageResult {
    const digest = createHash("sha256").update(this.id).update(page.data).digest();
    const sha8 = digest.subarray(0, 4).toString("hex");
    const texts = [
      `SANDBOX MOCK OCR ${this.label}`,
      `page ${page.pageNumber} sha ${sha8}`,
      `size ${page.width}x${page.height} dpi ${page.dpi} langs ${opts.langs.join("+")}`,
    ];
    const lineH = Math.max(12, Math.round(page.height / 40));
    const lines: OcrLine[] = [];
    let ix = 0;
    let sum = 0;
    let n = 0;
    texts.forEach((t, row) => {
      let x = Math.round(page.width * 0.05);
      const y0 = Math.round(page.height * 0.05) + row * lineH * 2;
      const words: OcrWord[] = t.split(" ").map((w) => {
        const conf = 0.8 + ((digest[(ix++) % digest.length] ?? 0) / 255) * 0.17;
        const wpx = Math.max(8, w.length * Math.round(lineH * 0.55));
        const word: OcrWord = { text: w, confidence: conf, bbox: { x0: x, y0, x1: x + wpx, y1: y0 + lineH } };
        x += wpx + Math.round(lineH * 0.3);
        sum += conf; n++;
        return word;
      });
      const lc = words.reduce((a, w) => a + w.confidence, 0) / words.length;
      lines.push({ text: t, confidence: lc, bbox: { x0: words[0]?.bbox.x0 ?? 0, y0, x1: x, y1: y0 + lineH }, words });
    });
    const text = texts.join("\n");
    const block: OcrBlock = {
      text,
      confidence: n ? sum / n : 0,
      bbox: { x0: lines[0]?.bbox.x0 ?? 0, y0: lines[0]?.bbox.y0 ?? 0, x1: Math.max(...lines.map((l) => l.bbox.x1)), y1: lines[lines.length - 1]?.bbox.y1 ?? 0 },
      lines,
    };
    return {
      pageNumber: page.pageNumber,
      text,
      blocks: [block],
      meanConfidence: n ? sum / n : 0,
      orientationDeg: 0,
      script: detectScript(text),
      providerId: this.id,
      timings: { totalMs: 0, recognizeMs: 0 },
      source: "ocr",
      metadata: { sandbox: true, mock: true, provider: this.id },
    };
  }
}

export class GoogleDocAiProvider extends CloudOcrProvider {
  readonly id = "google_docai" as const;
  protected readonly label = "Google Document AI";
}
export class AwsTextractProvider extends CloudOcrProvider {
  readonly id = "aws_textract" as const;
  protected readonly label = "AWS Textract";
}
export class AzureDocIntProvider extends CloudOcrProvider {
  readonly id = "azure_docint" as const;
  protected readonly label = "Azure Document Intelligence";
}
export class BhashiniProvider extends CloudOcrProvider {
  readonly id = "bhashini" as const;
  protected readonly label = "Bhashini";
}

export function createCloudProvider(id: CloudProviderId, config: CloudProviderConfig): OcrProvider {
  switch (id) {
    case "google_docai": return new GoogleDocAiProvider(config);
    case "aws_textract": return new AwsTextractProvider(config);
    case "azure_docint": return new AzureDocIntProvider(config);
    case "bhashini": return new BhashiniProvider(config);
  }
}
