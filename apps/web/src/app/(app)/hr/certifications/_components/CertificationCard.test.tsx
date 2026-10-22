import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { CertificationCard, type CertificationCardProps } from "./CertificationCard";

function renderCard(props: Partial<CertificationCardProps> = {}, locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <CertificationCard
        id="c1"
        certificationName="Cyber Security Awareness"
        issuingBody="NIC"
        obtainedDate="2025-09-15"
        expiryDate="2026-12-31"
        isMandatory
        status="expiring_soon"
        renewHref="/hr/training/t1"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("CertificationCard holder (GAP-HR-CERTIFICATIONS-02)", () => {
  it("names the holder and department when given", () => {
    renderCard({ holderName: "Priya Nair", holderDepartment: "Finance" });
    const holder = screen.getByTestId("certification-holder");
    expect(holder).toHaveTextContent("Priya Nair");
    expect(holder).toHaveTextContent("Finance");
  });

  it("omits the unresolved-department placeholder", () => {
    renderCard({ holderName: "Priya Nair", holderDepartment: "—" });
    expect(screen.getByTestId("certification-holder")).toHaveTextContent(/^Priya Nair$/);
  });

  it("renders no holder line when none is passed (a bare employee's own list)", () => {
    renderCard();
    expect(screen.queryByTestId("certification-holder")).not.toBeInTheDocument();
  });
});

describe("CertificationCard i18n (GAP-HR-CERTIFICATIONS-05)", () => {
  it("renders every label in English with IST-style dates", () => {
    renderCard({ status: "expiring_soon", expiryDate: "2999-01-01" });
    expect(screen.getByText("Mandatory")).toBeInTheDocument();
    expect(screen.getByText("Obtained")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.getByText("15 Sep 2025")).toBeInTheDocument();
    expect(screen.getByText("Renew Now")).toBeInTheDocument();
  });

  it("switching to Hindi changes every label, none left in English", () => {
    renderCard({ status: "expiring_soon", expiryDate: "2999-01-01" }, "hi");
    const hi = hiMessages.certifications;
    expect(screen.getByText(hi.mandatory)).toBeInTheDocument();
    expect(screen.getByText(hi.obtained)).toBeInTheDocument();
    expect(screen.getByText(hi.expires)).toBeInTheDocument();
    expect(screen.getByText(hi.statusExpiringSoon)).toBeInTheDocument();
    expect(screen.getByText(hi.renew)).toBeInTheDocument();
    for (const english of ["Mandatory", "Obtained", "Expires", "Expiring Soon", "Renew Now"]) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });

  it("translates the expired banner and the no-expiry state in Hindi", () => {
    renderCard({ status: "expired", expiryDate: "2020-01-01" }, "hi");
    expect(screen.getByRole("alert")).toHaveTextContent(hiMessages.certifications.bannerExpired);
    renderCard({ id: "c2", status: "no_expiry", expiryDate: null }, "hi");
    expect(screen.getAllByText(hiMessages.certifications.noExpiry).length).toBeGreaterThan(0);
  });

  it("the Hindi certifications namespace carries every English key", () => {
    expect(Object.keys(hiMessages.certifications).sort()).toEqual(Object.keys(enMessages.certifications).sort());
  });
});
