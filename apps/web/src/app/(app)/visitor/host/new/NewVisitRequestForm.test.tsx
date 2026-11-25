import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import en from "../../../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    const raw = (en.visitor.newRequest as Record<string, string>)[key] ?? key;
    return raw.replace(/\{(\w+)\}/g, (_, k: string) => vars?.[k] ?? "");
  },
}));

const createMock = vi.fn();
vi.mock("../../_data/client", () => ({
  createVisitRequest: (...a: unknown[]) => createMock(...a),
  CreateVisitRequestError: class extends Error {
    kind: string;
    constructor(kind: string) {
      super(kind);
      this.kind = kind;
    }
  },
}));

import { NewVisitRequestForm } from "./NewVisitRequestForm";

const HOST = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";

function future(): string {
  const d = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

describe("NewVisitRequestForm", () => {
  beforeEach(() => createMock.mockReset());

  it("hides the VIP category unless the caller may grant it", () => {
    const { rerender } = render(
      <NewVisitRequestForm hostEmployeeId={HOST} locations={[{ id: LOC, name: "Secretariat" }]} canGrantVip={false} />,
    );
    expect(screen.queryByRole("option", { name: "VIP" })).toBeNull();
    rerender(<NewVisitRequestForm hostEmployeeId={HOST} locations={[{ id: LOC, name: "Secretariat" }]} canGrantVip />);
    expect(screen.getByRole("option", { name: "VIP" })).toBeTruthy();
  });

  it("rejects an invalid mobile number without calling the API", async () => {
    const user = userEvent.setup();
    render(<NewVisitRequestForm hostEmployeeId={HOST} locations={[{ id: LOC, name: "Secretariat" }]} canGrantVip={false} />);
    await user.type(screen.getByLabelText("Visitor name"), "Meenakshi Sundaram");
    await user.type(screen.getByLabelText("Visitor mobile number"), "12345");
    await user.type(screen.getByLabelText("Purpose of visit"), "Tender review");
    await user.type(screen.getByLabelText("Expected arrival"), future());
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect((await screen.findByRole("alert")).textContent).toContain("10-digit");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("submits a host_preregister request with the signed-in host and +91 phone", async () => {
    createMock.mockResolvedValue({ id: "abc-123" });
    const user = userEvent.setup();
    render(<NewVisitRequestForm hostEmployeeId={HOST} locations={[{ id: LOC, name: "Secretariat" }]} canGrantVip={false} />);
    await user.type(screen.getByLabelText("Visitor name"), "Meenakshi Sundaram");
    await user.type(screen.getByLabelText("Visitor mobile number"), "98765 43210");
    await user.type(screen.getByLabelText("Purpose of visit"), "Tender review");
    await user.type(screen.getByLabelText("Expected arrival"), future());
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const arg = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.hostEmployeeId).toBe(HOST);
    expect(arg.locationId).toBe(LOC);
    expect(arg.visitorPhone).toBe("+919876543210");
    expect(arg.visitorCategory).toBe("standard");
    expect((await screen.findByRole("status")).textContent).toContain("Meenakshi Sundaram");
  });
});
