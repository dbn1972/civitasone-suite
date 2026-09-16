import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ConfigPanel } from "./ConfigPanel";
import type { PfmsConfig } from "./types";

// UX-017: ConfigPanel now reads its copy through next-intl (useTranslations),
// so it needs a real provider in the tree -- same pattern as
// hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderPanel(config: PfmsConfig | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConfigPanel config={config} />
    </NextIntlClientProvider>,
  );
}

describe("ConfigPanel", () => {
  it("renders the tenant's PFMS configuration", () => {
    renderPanel({ agencyCode: "AG01", defaultDdo: "DDO01" });
    expect(screen.getByText("AG01")).toBeInTheDocument();
    expect(screen.getByText("DDO01")).toBeInTheDocument();
  });

  it("renders an empty state when no configuration is set, without fabricating data", () => {
    renderPanel(null);
    expect(screen.getByText("No PFMS configuration set")).toBeInTheDocument();
  });

  it("renders an empty state when config exists but has no values", () => {
    renderPanel({ agencyCode: null, defaultDdo: null });
    expect(screen.getByText("No PFMS configuration set")).toBeInTheDocument();
  });
});
