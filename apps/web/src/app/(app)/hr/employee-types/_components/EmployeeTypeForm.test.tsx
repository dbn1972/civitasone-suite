import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EmployeeTypeForm } from "./EmployeeTypeForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.restoreAllMocks());

const renderForm = () =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EmployeeTypeForm mode="create" />
    </NextIntlClientProvider>,
  );

describe("EmployeeTypeForm (SF-14c: ds Field)", () => {
  it("ties every control to its label and marks code and name required", () => {
    renderForm();
    const code = screen.getByLabelText(/^Code/);
    expect(code).toBeRequired();
    expect(screen.getByLabelText(/^Type name/)).toBeRequired();
    for (const label of [/Description/, /Pay mode/i, /Category/i, /Payment route/i, /Tax section/i, /Default probation/i, /Max contract/i]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("blocks a blank submit with inline, field-linked errors and posts nothing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /create type/i }));
    const code = screen.getByLabelText(/^Code/);
    const name = screen.getByLabelText(/^Type name/);
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(code.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Code is required.");
    expect(document.getElementById(name.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Name must be at least 2 characters.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears a field error as soon as that field is edited", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /create type/i }));
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "CONTRACT" } });
    expect(screen.getByLabelText(/^Code/)).not.toHaveAttribute("aria-invalid", "true");
  });
});
