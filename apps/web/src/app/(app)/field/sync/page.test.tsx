import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("../_data", async (orig) => ({
  ...(await orig<typeof import("../_data")>()),
  getFieldSyncWithMeta: vi.fn(),
}));

import * as data from "../_data";
import Page from "./page";

const loader = vi.mocked(data.getFieldSyncWithMeta);
const empty = { rows: [], shown: 0, total: null, windowDays: 7, limit: 100 };

describe("field/sync page failure vs empty (round-1 review)", () => {
  it("omits the count note when the load failed", async () => {
    loader.mockResolvedValue({ data: empty, source: "error", status: 500 });
    render(await Page());
    expect(screen.queryByTestId("field-sync-window-note")).toBeNull();
  });

  it("shows the count note on a successful load", async () => {
    loader.mockResolvedValue({ data: empty, source: "api" });
    render(await Page());
    expect(screen.getByTestId("field-sync-window-note").textContent).toContain("0 shown");
  });
});
