import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Field } from "./Field";
import { EntityPicker } from "./EntityPicker";
import type { EntityOption, EntityPickerProps } from "./EntityPicker";

const OPTIONS: EntityOption[] = [
  { id: "e1", label: "Asha Rao", sublabel: "Finance" },
  { id: "e2", label: "Asha Verma", sublabel: "IT" },
];

function Harness(props: Partial<EntityPickerProps> & { initialValue?: string | string[] | null }) {
  const { initialValue = null, ...rest } = props;
  const [value, setValue] = useState<string | string[] | null>(initialValue);
  return (
    <Field label="Manager">
      <EntityPicker
        value={value}
        onChange={setValue}
        search={vi.fn(async () => [])}
        debounceMs={0}
        {...rest}
      />
    </Field>
  );
}

describe("EntityPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("associates with its Field label like a plain Input", () => {
    render(<Harness search={vi.fn(async () => OPTIONS)} />);
    const input = screen.getByLabelText("Manager");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("role", "combobox");
  });

  it("calls search with the typed query and an AbortSignal, then lists results", async () => {
    const search = vi.fn(async (_q: string, _signal: AbortSignal) => OPTIONS);
    render(<Harness search={search} />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });

    await waitFor(() => expect(search).toHaveBeenCalledWith("Asha", expect.any(AbortSignal)));
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
  });

  it("selects the active option on Enter, calling onChange with its id and closing the dropdown", async () => {
    render(<Harness search={vi.fn(async () => OPTIONS)} />);
    const input = screen.getByLabelText("Manager");
    fireEvent.change(input, { target: { value: "Asha" } });
    await screen.findByText("Asha Rao");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(input).toHaveValue("Asha Rao");
  });

  it("selects an option on mouse selection (mousedown, so it wins the race against outside-click/blur)", async () => {
    render(<Harness search={vi.fn(async () => OPTIONS)} />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });
    const option = await screen.findByText("Asha Verma");

    fireEvent.mouseDown(option);

    expect(await screen.findByDisplayValue("Asha Verma")).toBeInTheDocument();
  });

  it("shows a 'no results' status when search resolves empty for a real query", async () => {
    render(<Harness search={vi.fn(async () => [])} />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "zzz" } });

    expect(await screen.findByRole("status")).toHaveTextContent(/no matches/i);
  });

  it("resolve(ids) pre-populates the label for a value the picker did not choose itself (GAP-HR-EMPLOYEES-DETAIL-EDIT-04)", async () => {
    const resolve = vi.fn(async (ids: string[]) => ids.map((id) => OPTIONS.find((o) => o.id === id)!).filter(Boolean));
    render(<Harness initialValue="e1" resolve={resolve} search={vi.fn(async () => [])} />);

    await waitFor(() => expect(resolve).toHaveBeenCalledWith(["e1"]));
    expect(await screen.findByDisplayValue("Asha Rao")).toBeInTheDocument();
  });

  it("initialOptions pre-populates the label synchronously, without ever calling resolve for that id", async () => {
    const resolve = vi.fn(async () => []);
    render(
      <Harness
        initialValue="e1"
        initialOptions={[{ id: "e1", label: "Asha Rao", sublabel: "Finance" }]}
        resolve={resolve}
        search={vi.fn(async () => [])}
      />,
    );

    expect(await screen.findByDisplayValue("Asha Rao")).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("multiple: accumulates selections as chips and supports removing one", async () => {
    render(<Harness multiple search={vi.fn(async () => OPTIONS)} />);
    const input = screen.getByLabelText("Manager");

    fireEvent.change(input, { target: { value: "Asha" } });
    fireEvent.mouseDown(await screen.findByText("Asha Rao"));
    fireEvent.change(input, { target: { value: "Asha" } });
    fireEvent.mouseDown(await screen.findByText("Asha Verma"));

    expect(screen.getAllByText(/Asha (Rao|Verma)/).length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: /remove asha rao/i }));
    await waitFor(() => expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument());
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
  });

  it("renders one hidden input per selected id, sharing the given name, for a plain form post", async () => {
    const { container } = render(
      <Harness multiple name="managerIds" initialValue={["e1", "e2"]} initialOptions={OPTIONS} search={vi.fn(async () => [])} />,
    );
    const hidden = container.querySelectorAll('input[type="hidden"][name="managerIds"]');
    expect(hidden).toHaveLength(2);
    expect(Array.from(hidden).map((el) => (el as HTMLInputElement).value).sort()).toEqual(["e1", "e2"]);
  });
});
