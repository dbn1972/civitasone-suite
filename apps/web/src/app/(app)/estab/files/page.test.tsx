import { describe, it, expect, vi } from "vitest";

const permanentRedirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  permanentRedirect: (path: string) => permanentRedirectMock(path),
}));

import EstabFilesPage from "./page";

// GAP-ESTABLISHMENT-FILES-01: /estab/files is a grouping segment (children
// /estab/files/[id] and /estab/files/new) that previously had no index page and
// 404'd when hand-typed or linked from a breadcrumb. It now resolves to the
// canonical File Register list with a permanent (308) redirect.
describe("EstabFilesPage", () => {
  it("permanently redirects /estab/files to the file register list", () => {
    EstabFilesPage();
    expect(permanentRedirectMock).toHaveBeenCalledWith("/estab/list");
  });
});
