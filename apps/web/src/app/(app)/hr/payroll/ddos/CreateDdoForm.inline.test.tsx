import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { CreateDdoForm } from "./CreateDdoForm";

const renderForm = () =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateDdoForm existing={[]} departments={[]} departmentsAvailable />
    </NextIntlClientProvider>,
  );

describe("CreateDdoForm inline field errors (SF-14c)", () => {
  it("shows a specific, field-linked message for a blank code and name", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /save|add|create/i }));
    const code = screen.getByLabelText(/^DDO code/i);
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(code.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Enter the DDO code.");
    expect(document.getElementById(screen.getByLabelText(/^Name/i).getAttribute("aria-describedby") ?? "")).toHaveTextContent("Enter the DDO name.");
  });

  it("flags a malformed code with the format message", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^DDO code/i), { target: { value: "DDO 01" } });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Treasury" } });
    fireEvent.click(screen.getByRole("button", { name: /save|add|create/i }));
    const code = screen.getByLabelText(/^DDO code/i);
    expect(document.getElementById(code.getAttribute("aria-describedby") ?? "")).toHaveTextContent(/letters, digits/i);
  });
});
