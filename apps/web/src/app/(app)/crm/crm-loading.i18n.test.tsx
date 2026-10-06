import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";
import RtiNewLoading from "./rti/new/loading";
import AgentWorkloadLoading from "./agent-workload/loading";
import ServiceRequestsLoading from "./service-requests/loading";

const hi = (ui: React.ReactElement) => render(<NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);

describe("CRM loading skeletons are translated", () => {
  it("renders Hindi headings and aria-labels (no English fallback)", () => {
    hi(<AgentWorkloadLoading />);
    expect(screen.getByRole("heading", { name: "एजेंट कार्यभार" })).toBeInTheDocument();
    expect(screen.queryByText("Agent Workload")).not.toBeInTheDocument();
  });
  it("translates PageHeader title and the busy label", () => {
    hi(<RtiNewLoading />);
    expect(screen.getByText("नया आरटीआई अनुरोध")).toBeInTheDocument();
    expect(screen.getByLabelText("आरटीआई अनुरोध फ़ॉर्म लोड हो रहा है…")).toBeInTheDocument();
  });
  it("translates the service requests list skeleton", () => {
    hi(<ServiceRequestsLoading />);
    expect(screen.getByLabelText("सेवा अनुरोध लोड हो रहे हैं…")).toBeInTheDocument();
  });
});
