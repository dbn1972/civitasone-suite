import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const serviceIdParam = { value: "" as string };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(serviceIdParam.value ? `serviceId=${serviceIdParam.value}` : ""),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { IntakePanel } from "./IntakePanel";

const SERVICES = [
  { id: "svc-1", name: "Birth Certificate", ownerDepartment: "Health", channels: ["portal"] },
  { id: "svc-2", name: "Trade Licence", ownerDepartment: "Revenue", channels: ["portal"] },
];

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("IntakePanel (GAP-CITIZEN-CATALOGUE-04)", () => {
  it("chooses the service by NAME (a select), never a raw UUID text input", () => {
    serviceIdParam.value = "";
    wrap(<IntakePanel services={SERVICES} assistingOfficer={null} />);
    const select = screen.getByLabelText(enMessages.citizenIntake.serviceLabel) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: /Birth Certificate/ })).toBeInTheDocument();
  });

  it("preselects the service from a ?serviceId= deep link", () => {
    serviceIdParam.value = "svc-2";
    wrap(<IntakePanel services={SERVICES} assistingOfficer={null} />);
    const select = screen.getByLabelText(enMessages.citizenIntake.serviceLabel) as HTMLSelectElement;
    expect(select.value).toBe("svc-2");
  });

  it("ignores a ?serviceId= that is not a known service", () => {
    serviceIdParam.value = "unknown-id";
    wrap(<IntakePanel services={SERVICES} assistingOfficer={null} />);
    const select = screen.getByLabelText(enMessages.citizenIntake.serviceLabel) as HTMLSelectElement;
    expect(select.value).toBe("");
  });
});
