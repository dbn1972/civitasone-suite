import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateDdoForm } from "./CreateDdoForm";
import { diffDdoMapping, type DdoRecord } from "./ddoData";

const D1 = "aaaaaaaa-0000-0000-0000-000000000001";
const D2 = "aaaaaaaa-0000-0000-0000-000000000002";
const D3 = "aaaaaaaa-0000-0000-0000-000000000003";
const DEPTS = [
  { id: D1, code: "REV", name: "Revenue" },
  { id: D2, code: "HLT", name: "Health" },
  { id: D3, code: "EDU", name: "Education" },
];
const EXISTING: DdoRecord[] = [
  { ddoCode: "DDO01", name: "Treasury", departmentIds: [D1, D2] },
  { ddoCode: "DDO09", name: "Schools", departmentIds: [D3] },
];

function renderForm(props: Partial<React.ComponentProps<typeof CreateDdoForm>> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateDdoForm existing={EXISTING} departments={DEPTS} departmentsAvailable {...props} />
    </NextIntlClientProvider>,
  );
}

describe("diffDdoMapping (DDOS-02)", () => {
  it("lists added, removed and moved-from-another-DDO departments", () => {
    const diff = diffDdoMapping("DDO01", [D2, D3], EXISTING);
    expect(diff.isUpdate).toBe(true);
    expect(diff.added).toEqual([D3]);
    expect(diff.removed).toEqual([D1]);
    expect(diff.movedFrom.get(D3)).toBe("DDO09");
  });
});

describe("CreateDdoForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires DDO code and name before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByText("Save DDO"));
    expect(screen.getByText("DDO code and name are required.")).toBeInTheDocument();
  });

  it("rejects a DDO code with spaces (DDOS-05)", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO 02" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "New DDO" } });
    fireEvent.click(screen.getByText("Save DDO"));
    expect(screen.getByText(/DDO code can contain only letters/)).toBeInTheDocument();
    expect(screen.queryByText("Save this DDO?")).not.toBeInTheDocument();
  });

  it("has no free-text department-id box (DDOS-01)", () => {
    renderForm();
    expect(screen.queryByLabelText(/comma-separated UUIDs/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Departments")).toBeInTheDocument();
  });

  it("shows the mapping diff in edit mode and requires a reason (DDOS-02)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "DDO01", status: "accepted", correlationId: "c" }), { status: 202 }),
    );
    renderForm({ editing: EXISTING[0] });
    // Remove Revenue via its chip.
    fireEvent.click(screen.getByRole("button", { name: "Remove Revenue" }));
    fireEvent.click(screen.getByText("Update DDO"));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Removed: Revenue (REV)")).toBeInTheDocument();
    expect(within(dialog).getByText("Added: none")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Confirm save" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Reason for this change/), { target: { value: "Revenue moved to new DDO" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText(/DDO01 — Treasury saved/)).toBeInTheDocument());
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ ddoCode: "DDO01", name: "Treasury", departmentIds: [D2], reason: "Revenue moved to new DDO" });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO03" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Another DDO" } });
    fireEvent.click(screen.getByText("Save DDO"));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for this change/), { target: { value: "New DDO for audit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm save" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
