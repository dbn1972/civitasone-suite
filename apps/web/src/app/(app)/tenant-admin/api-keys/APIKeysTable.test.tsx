import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { APIKeysTable } from "./APIKeysTable";

const base = {
  keyPrefix: "ak_live",
  scopes: ["finance:read"],
  lastUsedAt: undefined,
  expiresAt: undefined,
};

describe("APIKeysTable — GAP-TENANT-ADMIN-API-KEYS-05", () => {
  it("renders every status through the shared StatusPill (consistent markup, humanized labels)", () => {
    const { container } = render(
      <APIKeysTable
        keys={[
          { id: "a", keyName: "Active key", status: "active", ...base },
          { id: "e", keyName: "Expired key", status: "expired", ...base },
          { id: "r", keyName: "Revoked key", status: "revoked", ...base },
        ]}
      />,
    );
    // Collect the status pills from the table body only (the Segmented filter
    // above also contains the words Active/Expired/Revoked).
    const pills = Array.from(container.querySelectorAll("tbody .pill")).map((el) => ({
      text: el.textContent,
      cls: el.className,
    }));
    const byText = (t: string) => pills.find((p) => p.text === t);
    expect(byText("Active")).toBeTruthy();
    expect(byText("Expired")).toBeTruthy();
    expect(byText("Revoked")).toBeTruthy();
    // expired/revoked both map to the "bad" tone in STATUS_MAP; active -> good.
    expect(byText("Expired")!.cls).toMatch(/\bbad\b/);
    expect(byText("Revoked")!.cls).toMatch(/\bbad\b/);
    expect(byText("Active")!.cls).toMatch(/\bgood\b/);
  });

  it("shows a tailored empty state (not the generic 'No records found') when there are zero keys", () => {
    render(<APIKeysTable keys={[]} />);
    expect(screen.getByText(/No API keys yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No records found/i)).not.toBeInTheDocument();
  });
});
