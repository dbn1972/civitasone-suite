import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// MaskedReveal (audited reveal control) is translated client-side (piiReveal).
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: <T,>(_key: string, initialData: T) => ({
    data: initialData,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { GrantsTable } from "./GrantsTable";
import type { GrantSummary } from "@civitasone/types";

const ROW: GrantSummary = {
  id: "grant-1",
  grantNo: "GR-2026-04",
  title: "Water supply",
  granteeName: "Asha Devi",
  totalAmount: 1000000,
  disbursedAmount: 400000,
  pendingAmount: 600000,
  sanctionDate: "2026-08-12",
  status: "active",
} as unknown as GrantSummary;

describe("GrantsTable", () => {
  // GAP-GRANTS-LIST-03: non-privileged viewer sees the grantee name masked.
  it("masks the grantee name for a non-privileged viewer", () => {
    render(<GrantsTable grants={[ROW]} source="api" canViewGranteeName={false} />);
    expect(screen.queryByText("Asha Devi")).not.toBeInTheDocument();
    expect(screen.getByText(/^A•+$/)).toBeInTheDocument();
  });

  it("shows the grantee name in the clear for a privileged viewer", () => {
    render(<GrantsTable grants={[ROW]} source="api" canViewGranteeName={true} />);
    expect(screen.getByText("Asha Devi")).toBeInTheDocument();
  });

  // GAP-GRANTS-LIST-04: no inconsistent "(₹)" unit on the Total heading.
  it("labels the Total column without a '(₹)' unit", () => {
    render(<GrantsTable grants={[ROW]} source="api" />);
    expect(screen.queryByText("Total (₹)")).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  // GAP-GRANTS-LIST-03 (UAT B4): grant-service masks natural persons at source and offers an audited reveal.
  describe("server-masked natural person", () => {
    const MASKED = { ...ROW, granteeId: "ben-1", granteeName: "A••••••••", granteeType: "individual", granteeNameMasked: true } as unknown as GrantSummary;

    it("shows only the masked name and no Reveal button to a viewer without the reveal role", () => {
      render(<GrantsTable grants={[MASKED]} source="api" canViewGranteeName={false} />);
      expect(screen.getByText("A••••••••")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    });

    it("offers an audited Reveal to a maker role and posts the reason to the grants reveal endpoint", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { value: "Asha Devi" } }), { status: 200, headers: { "content-type": "application/json" } }),
      );
      render(<GrantsTable grants={[MASKED]} source="api" canViewGranteeName />);
      expect(screen.queryByText("Asha Devi")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
      const reason = await screen.findByRole("textbox");
      fireEvent.change(reason, { target: { value: "Verifying payee for sanction file 14/2026" } });
      // The dialog adds a second "Reveal" button (the confirm action) after the row control.
      fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).at(-1)!);
      await waitFor(() => expect(screen.getByText("Asha Devi")).toBeInTheDocument());
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain("v1/grants/pii/reveal");
      expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
        resourceType: "grantee", resourceId: "ben-1", field: "name", reason: "Verifying payee for sanction file 14/2026",
      });
      fetchSpy.mockRestore();
    });

    it("shows an institution grantee in the clear for everyone, with no Reveal", () => {
      const inst = { ...ROW, granteeId: "ben-2", granteeName: "Nashik Mahila Mandal", granteeType: "society", granteeNameMasked: false } as unknown as GrantSummary;
      render(<GrantsTable grants={[inst]} source="api" canViewGranteeName={false} />);
      expect(screen.getByText("Nashik Mahila Mandal")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    });
  });
});
