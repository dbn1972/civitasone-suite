import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { CitizenRequestsClient } from "./CitizenRequestsClient";

function renderClient(requests: Parameters<typeof CitizenRequestsClient>[0]["requests"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CitizenRequestsClient requests={requests} />
    </NextIntlClientProvider>,
  );
}

const sample = [
  { id: "1", requestNo: "GR-ABC", citizenName: "A", serviceType: "grievance", submittedAt: "2026-03-05", citizenPhone: "XXXXXX1234", status: "submitted" },
];

describe("CitizenRequestsClient", () => {
  it("GAP-CITIZEN-REQUESTS-05: segment labels come from i18n (All/Grievance/Service)", () => {
    renderClient(sample);
    expect(screen.getByRole("tab", { name: enMessages.citizenRequests.segAll })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: enMessages.citizenRequests.segGrievance })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: enMessages.citizenRequests.segService })).toBeInTheDocument();
  });

  it("GAP-CITIZEN-REQUESTS-04: the unsupported 'Breached' segment is gone", () => {
    renderClient(sample);
    expect(screen.queryByRole("tab", { name: /breached/i })).not.toBeInTheDocument();
  });

  it("GAP-CITIZEN-REQUESTS-02: the phone column renders the server-masked value as given (no raw digits requested)", () => {
    renderClient(sample);
    expect(screen.getByText("XXXXXX1234")).toBeInTheDocument();
  });
});
