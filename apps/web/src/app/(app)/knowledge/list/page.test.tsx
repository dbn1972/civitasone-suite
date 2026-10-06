import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
}));

import KnowledgeListPage from "./page";

// GAP-KNOWLEDGE-LIST-03: /knowledge/list redirects to /knowledge/repository
describe("KnowledgeListPage redirect", () => {
  it("redirects to /knowledge/repository", () => {
    KnowledgeListPage();
    expect(redirectMock).toHaveBeenCalledWith("/knowledge/repository");
  });
});
