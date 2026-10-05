import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Masked, maskAccount, maskPhone, maskEmail } from "./Masked";

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
