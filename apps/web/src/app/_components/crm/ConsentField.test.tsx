import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { ConsentField, CONSENT_PURPOSES, CONSENT_CHANNELS } from "./ConsentField";

const granted = { granted: true, purpose: "", channel: "" };

describe("ConsentField (GAP-CRM-CONTACTS-DETAIL-EDIT-07)", () => {
  it("renders the English consent copy, purposes and channels", () => {
    renderWithIntl(<ConsentField value={granted} onChange={vi.fn()} lastRecordedAt="2026-08-03T12:00:00Z" />);
    expect(screen.getByText("Marketing consent (DPDP Act, 2023)")).toBeInTheDocument();
    expect(screen.getByLabelText("I consent to marketing communications")).toBeChecked();
    expect(screen.getByRole("option", { name: "Select a purpose…" })).toBeInTheDocument();
    for (const p of ["Marketing communications", "Transactional messages", "Service updates", "Research / surveys"]) {
      expect(screen.getByRole("option", { name: p })).toBeInTheDocument();
    }
    for (const c of ["Web form", "Email", "Phone", "In person", "Bulk import"]) {
      expect(screen.getByRole("option", { name: c })).toBeInTheDocument();
    }
    expect(screen.getByText(/^Last recorded .+\.$/)).toBeInTheDocument();
  });

  it("renders every purpose and channel value in Hindi (no English fallback)", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <ConsentField value={granted} onChange={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("विपणन सहमति (डीपीडीपी अधिनियम, 2023)")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2 + CONSENT_PURPOSES.length + CONSENT_CHANNELS.length);
    expect(screen.queryByRole("option", { name: "Web form" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "वेब फ़ॉर्म" })).toBeInTheDocument();
  });

  it("emits the stored values (not the translated labels) on change", () => {
    const onChange = vi.fn();
    renderWithIntl(<ConsentField value={granted} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^Purpose/), { target: { value: "service_updates" } });
    expect(onChange).toHaveBeenCalledWith({ granted: true, purpose: "service_updates", channel: "" });
  });
});
