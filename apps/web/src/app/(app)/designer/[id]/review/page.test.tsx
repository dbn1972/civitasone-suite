import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "def-1" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The draft under review — version is overridden per test.
let defVersion = 1;
vi.mock("../../_data/useDesignerWizard", () => ({
  useDesignerWizard: () => ({
    loading: false,
    error: null,
    def: {
      id: "def-1",
      serviceKey: "svc-key-1",
      version: defVersion,
      status: "draft",
      name: "Svc",
      servicePattern: "certificate",
    },
    meta: { name: "Svc", version: defVersion, status: "draft", submittedBy: "user-2", serviceKey: "svc-key-1", pattern: "certificate" },
  }),
}));

vi.mock("../../_data/useDesignerSession", () => ({ useDesignerSession: () => ({ userId: "user-1" }) }));

const fetchPublishedByKey = vi.fn(async () => null);
const publishDefinition = vi.fn(async () => {});
const rejectDefinition = vi.fn(async () => {});
vi.mock("../../_data/designerReviewApi", () => ({
  fetchPublishedByKey: (...a: unknown[]) => fetchPublishedByKey(...(a as [])),
  publishDefinition: (...a: unknown[]) => publishDefinition(...(a as [])),
  rejectDefinition: (...a: unknown[]) => rejectDefinition(...(a as [])),
}));

vi.mock("../../_data/feeBuilderApi", () => ({ fetchHoaDescriptions: vi.fn(async () => ({})) }));
vi.mock("../../_data/documentBuilderModel", () => ({ documentsReviewSummary: () => [] }));
vi.mock("../../_data/versionDiffModel", () => ({ publishSummary: () => [] as string[] }));
vi.mock("../../_data/designerConstants", () => ({
  DEFAULT_BLOCKS: [] as Array<{ id: string }>,
  hiddenBlocksForPattern: () => new Set<string>(),
  SERVICE_PATTERN_OPTIONS: [{ id: "certificate", label: "Certificate" }],
}));

vi.mock("@/app/_components/ds/designer", () => ({
  WizardShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  VersionDiff: () => <div data-testid="version-diff" />,
}));
vi.mock("../../_components/AccessibilityPreview", () => ({ AccessibilityPreview: () => <div /> }));
vi.mock("../../_components/DesignIssuesList", () => ({ DesignIssuesList: () => <div /> }));

import DesignerReviewPage from "./page";

describe("DesignerReviewPage — first-publish published/lookup", () => {
  beforeEach(() => {
    fetchPublishedByKey.mockClear();
  });

  // UAT L1 console-404 cleanup: a first version (v1) has no published
  // predecessor, so published/lookup is a guaranteed 404. The page must not
  // fire that read (it would only log a console 404).
  it("does not look up the published version for a first (v1) draft", async () => {
    defVersion = 1;
    render(<DesignerReviewPage />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchPublishedByKey).not.toHaveBeenCalled();
  });

  it("looks up the published predecessor when the draft is a later version", async () => {
    defVersion = 2;
    render(<DesignerReviewPage />);
    await waitFor(() => expect(fetchPublishedByKey).toHaveBeenCalledWith("svc-key-1"));
  });
});
