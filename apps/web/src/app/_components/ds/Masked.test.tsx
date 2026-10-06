import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { Masked, maskAccount, maskPhone, maskEmail, maskName } from "./Masked";

function withIntl(ui: React.ReactElement) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

describe("Masked", () => {
  it("masks PAN as before", () => {
    render(<Masked kind="pan" value="ABCDE1234F" />);
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
  });

  // GAP-PAYROLL-DISBURSEMENT-01
  it("shows only the last 4 digits of a bank account", () => {
    const { container } = render(<Masked kind="account" value="123456781234" ariaLabel="Account ending 1234" />);
    expect(screen.getByText("••••1234")).toBeInTheDocument();
    expect(screen.getByLabelText("Account ending 1234")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("12345678");
  });

  it("masks a too-short account value in full", () => {
    expect(maskAccount("1234")).toBe("••••");
    expect(maskAccount(" 99887766 ")).toBe("••••7766");
  });

  it("renders the fallback for a missing value", () => {
    render(<Masked kind="account" value={null} fallback={<span>none</span>} />);
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});

// GAP-CRM-CONTACTS-02 / GAP-CRM-CONTACTS-DETAIL-02
describe("Masked phone/email (CRM PII)", () => {
  it("masks a phone keeping only first 2 and last 3 digits", () => {
    expect(maskPhone("9876543210")).toBe("98XXXXX210");
    render(<Masked kind="phone" value="9876543210" />);
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
  });

  it("masks an email showing only first chars of local and domain labels", () => {
    expect(maskEmail("asha@example.com")).toBe("a***@e******.c**");
    render(<Masked kind="email" value="asha@example.com" />);
    expect(screen.getByText("a***@e******.c**")).toBeInTheDocument();
  });

  it("masks implausible values in full", () => {
    expect(maskPhone("12")).toBe("XXXX");
    expect(maskEmail("notanemail")).not.toContain("notanemail");
  });
});

// F1-05: Masked gains an optional onReveal config that, for a reveal-allowed
// viewer, renders the interactive audited reveal control (MaskedReveal).
describe("Masked onReveal (F1-05 audited reveal)", () => {
  const reveal = {
    canReveal: true,
    resourceType: "grievance" as const,
    resourceId: "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0",
    field: "citizenPhone",
    label: "citizen phone",
  };

  it("renders a Reveal control when onReveal.canReveal is true", () => {
    render(withIntl(<Masked kind="phone" value="******3210" onReveal={reveal} />));
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
  });

  it("renders NO reveal control when canReveal is false (static masked render)", () => {
    render(withIntl(<Masked kind="phone" value="******3210" onReveal={{ ...reveal, canReveal: false }} />));
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  it("stays a static render with no reveal control when onReveal is omitted", () => {
    render(<Masked kind="phone" value="9876543210" />);
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });
});

describe("maskName (GAP-CITIZEN-GRIEVANCES-03)", () => {
  it("masks each part keeping first chars and the last char of the final part", () => {
    expect(maskName("Ramesh Kumar")).toBe("R••••• K•••r");
  });
  it("masks a single short token", () => {
    expect(maskName("Sita")).toBe("S••a");
    expect(maskName("A")).toBe("•");
    expect(maskName("Jo")).toBe("J•");
  });
  it("returns empty string for empty input", () => {
    expect(maskName("   ")).toBe("");
  });
});
