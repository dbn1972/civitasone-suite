import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ADMIN_EDITIONS } from "@civitasone/tenant-profile";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { EDITIONS } from "@/lib/admin/platformIntegrations";
import type { TenantApprovalPolicy } from "@/app/_data/loaders";
import { TenantLifecycleSection } from "./TenantLifecycleSection";

const policy: TenantApprovalPolicy = { requiresSecondApprover: true, approverRoles: ["super_admin"], minApprovals: 1, reasonRequired: true, notifyTenantAdmins: true };

function ui(locale: "en" | "hi" = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <TenantLifecycleSection
        tenantId="11111111-aaaa-4000-8000-000000000001" tenantName="Acme Trust" tenantStatus="active"
        current={{ name: "Acme Trust", domain: "acme.org", edition: "section8" }}
        initialRequests={[]} requestsSource="api" policy={policy}
      />
    </NextIntlClientProvider>
  );
}

describe("B8 data-driven edition selector", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("both web edition lists are the catalogue ADMIN_EDITIONS (incl. section8)", () => {
    expect([...EDITIONS]).toEqual([...ADMIN_EDITIONS]);
    expect(EDITIONS).toContain("section8");
  });

  it("every catalogue edition has an en and hi label in both edition maps", () => {
    for (const m of [enMessages, hiMessages] as unknown as Array<Record<string, Record<string, Record<string, string>>>>) {
      for (const ed of ADMIN_EDITIONS) {
        expect(m.tenantLifecycle?.edition?.[ed], `tenantLifecycle.edition.${ed}`).toBeTruthy();
        expect(m.platformIntegrations?.editions?.[ed], `platformIntegrations.editions.${ed}`).toBeTruthy();
      }
    }
  });

  it("the edit dialog's Edition select lists every catalogue edition, section8 selectable, and has no axe violations", async () => {
    const { container } = render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const dialog = await screen.findByRole("alertdialog");
    const select = within(dialog).getByLabelText("Edition") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([...ADMIN_EDITIONS]);
    expect(select.value).toBe("section8");
    expect(within(select).getByRole("option", { name: "Section 8 company" })).toBeInTheDocument();
    const axe = (await import("axe-core")).default;
    const out = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(out.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    void container;
  });
});
