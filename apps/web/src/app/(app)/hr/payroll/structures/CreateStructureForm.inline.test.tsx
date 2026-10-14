import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { CreateStructureForm } from "./CreateStructureForm";

describe("CreateStructureForm inline field errors (SF-14c)", () => {
  it("links the schema error to the name field via aria-describedby and clears it on edit", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreateStructureForm />
      </NextIntlClientProvider>,
    );
    const name = screen.getByLabelText(/^Name/);
    expect(name).toBeRequired();
    fireEvent.click(screen.getByText("Create Structure"));
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(name.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Enter a structure name.");
    fireEvent.change(name, { target: { value: "Level 6" } });
    fireEvent.click(screen.getByText("Create Structure"));
    expect(name).not.toHaveAttribute("aria-invalid", "true");
  });
});
