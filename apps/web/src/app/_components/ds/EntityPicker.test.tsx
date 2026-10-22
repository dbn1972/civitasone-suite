import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("shows an error alert, not \"No matches\", when search rejects (SF-06)", async () => {
    const search = vi.fn(async () => {
      throw new Error("entity lookup failed: HTTP 500");
    });
    render(<Harness search={search} searchErrorText="Could not load the list." />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the list.");
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("opt-in searchRetryLabel adds a Try again button that re-runs the CURRENT query (GAP-HR-LEAVE-BALANCE-05)", async () => {
    const search = vi
      .fn<(q: string, s: AbortSignal) => Promise<EntityOption[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(OPTIONS);
    render(<Harness search={search} searchErrorText="Could not load the list." searchRetryLabel="Try again" />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the list.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1]![0]).toBe("Asha"); // same query, no retyping
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no retry button unless searchRetryLabel is given (existing callers unchanged)", async () => {
    const search = vi.fn(async () => { throw new Error("boom"); });
    render(<Harness search={search} searchErrorText="Could not load the list." />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });

    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PAYMENTS-DETAIL-02: retry without having to edit the query.
  it("offers a retry button on a failed search (when retryText is given) that re-runs the same query", async () => {
    const search = vi
      .fn<(q: string, s: AbortSignal) => Promise<EntityOption[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(OPTIONS);
    render(<Harness search={search} retryText="Try again" />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });
    await screen.findByRole("alert");
    expect(search).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1]?.[0]).toBe("Asha");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("keeps the retry button while the retry fails again, and shows none when retryText is omitted", async () => {
    const search = vi.fn(async () => { throw new Error("still down"); });
    const { unmount } = render(<Harness search={search} retryText="Try again" />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    unmount();

    render(<Harness search={search} />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });
    await screen.findByRole("alert");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("clears the error and lists results once a later search succeeds", async () => {
    const search = vi
      .fn<(q: string, s: AbortSignal) => Promise<EntityOption[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(OPTIONS);
    render(<Harness search={search} />);
    const input = screen.getByLabelText("Manager");
    fireEvent.change(input, { target: { value: "As" } });
    await screen.findByRole("alert");

    fireEvent.change(input, { target: { value: "Asha" } });
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still says \"No matches\" when search succeeds with an empty list", async () => {
    render(<Harness search={vi.fn(async () => [])} />);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "zzz" } });
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  describe("combobox semantics and keyboard navigation (GAP-WORKS-APPROVALS-TS-NEW-01)", () => {
    const THREE: EntityOption[] = [
      { id: "w1", label: "WK/001" },
      { id: "w2", label: "WK/002" },
      { id: "w3", label: "WK/003" },
    ];
    const activeId = (input: HTMLElement) => input.getAttribute("aria-activedescendant");
    const optionId = (label: string) => screen.getByRole("option", { name: new RegExp(label) }).id;

    it("exposes combobox + listbox + option roles with aria-expanded / aria-controls / aria-autocomplete wired up", async () => {
      render(<Harness search={vi.fn(async () => THREE)} />);
      const input = screen.getByLabelText("Manager");
      expect(input).toHaveAttribute("role", "combobox");
      expect(input).toHaveAttribute("aria-autocomplete", "list");
      expect(input).toHaveAttribute("aria-expanded", "false");
      fireEvent.change(input, { target: { value: "WK" } });
      const listbox = await screen.findByRole("listbox");
      expect(input).toHaveAttribute("aria-expanded", "true");
      expect(input.getAttribute("aria-controls")).toBe(listbox.id);
      expect(screen.getAllByRole("option")).toHaveLength(3);
    });

    it("ArrowDown / ArrowUp move aria-activedescendant through the options, clamp at both ends, and Enter picks the active one", async () => {
      render(<Harness search={vi.fn(async () => THREE)} />);
      const input = screen.getByLabelText("Manager");
      fireEvent.change(input, { target: { value: "WK" } });
      await screen.findByRole("listbox");
      expect(activeId(input)).toBe(optionId("WK/001"));

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(activeId(input)).toBe(optionId("WK/002"));
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" }); // already on the last one: stays
      expect(activeId(input)).toBe(optionId("WK/003"));
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(activeId(input)).toBe(optionId("WK/002"));
      fireEvent.keyDown(input, { key: "ArrowUp" });
      fireEvent.keyDown(input, { key: "ArrowUp" }); // already on the first one: stays
      expect(activeId(input)).toBe(optionId("WK/001"));

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(input).toHaveValue("WK/002"));
    });

    it("Escape closes the list", async () => {
      render(<Harness search={vi.fn(async () => THREE)} />);
      const input = screen.getByLabelText("Manager");
      fireEvent.change(input, { target: { value: "WK" } });
      await screen.findByRole("listbox");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input).toHaveAttribute("aria-expanded", "false");
    });

    const WITH_DISABLED: EntityOption[] = [
      { id: "w1", label: "WK/001" },
      { id: "w2", label: "WK/002", disabledReason: "Not DAO-finalized" },
      { id: "w3", label: "WK/003" },
    ];

    it("lists a disabled option with its reason and aria-disabled, instead of hiding it", async () => {
      render(<Harness search={vi.fn(async () => WITH_DISABLED)} />);
      fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "WK" } });
      const disabled = await screen.findByRole("option", { name: /WK\/002/ });
      expect(disabled).toHaveAttribute("aria-disabled", "true");
      expect(disabled).toHaveTextContent("Not DAO-finalized");
      expect(screen.getByRole("option", { name: /WK\/001/ })).not.toHaveAttribute("aria-disabled");
    });

    it("arrow keys skip a disabled option and Enter never picks it", async () => {
      render(<Harness search={vi.fn(async () => WITH_DISABLED)} />);
      const input = screen.getByLabelText("Manager");
      fireEvent.change(input, { target: { value: "WK" } });
      await screen.findByRole("listbox");
      expect(activeId(input)).toBe(optionId("WK/001"));
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(activeId(input)).toBe(optionId("WK/003")); // WK/002 skipped
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(activeId(input)).toBe(optionId("WK/001"));
      expect(activeId(input)).not.toBe(optionId("WK/002"));
    });

    it("the first active option is the first ENABLED one when the list starts with a disabled option", async () => {
      const disabledFirst: EntityOption[] = [{ id: "d", label: "WK/000", disabledReason: "Not DAO-finalized" }, ...THREE];
      render(<Harness search={vi.fn(async () => disabledFirst)} />);
      const input = screen.getByLabelText("Manager");
      fireEvent.change(input, { target: { value: "WK" } });
      await screen.findByRole("listbox");
      expect(activeId(input)).toBe(optionId("WK/001"));
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(input).toHaveValue("WK/001"));
    });

    it("clicking a disabled option selects nothing and leaves the list open; clicking an enabled one selects it", async () => {
      const onChange = vi.fn();
      render(<Harness search={vi.fn(async () => WITH_DISABLED)} onChange={onChange} />);
      const input = screen.getByLabelText("Manager");
      fireEvent.change(input, { target: { value: "WK" } });
      fireEvent.mouseDown(await screen.findByRole("option", { name: /WK\/002/ }));
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole("option", { name: /WK\/003/ }));
      expect(onChange).toHaveBeenCalledWith("w3");
    });

    it("when every option is disabled nothing is active and Enter selects nothing", async () => {
      const onChange = vi.fn();
      const allDisabled = THREE.map((o) => ({ ...o, disabledReason: "Not DAO-finalized" }));
      render(<Harness search={vi.fn(async () => allDisabled)} onChange={onChange} />);
      const input = screen.getByLabelText("Manager");
      fireEvent.change(input, { target: { value: "WK" } });
      await screen.findByRole("listbox");
      expect(activeId(input)).toBeNull();
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it("renders one hidden input per selected id, sharing the given name, for a plain form post", async () => {
    const { container } = render(
      <Harness multiple name="managerIds" initialValue={["e1", "e2"]} initialOptions={OPTIONS} search={vi.fn(async () => [])} />,
    );
    const hidden = container.querySelectorAll('input[type="hidden"][name="managerIds"]');
    expect(hidden).toHaveLength(2);
    expect(Array.from(hidden).map((el) => (el as HTMLInputElement).value).sort()).toEqual(["e1", "e2"]);
  });
  // GAP-HR-PROMOTION-05
  describe("retryText / onFailedChange", () => {
    it("shows a Retry button beside the error that re-runs the last query, and recovers", async () => {
      const search = vi
        .fn<(q: string, s: AbortSignal) => Promise<EntityOption[]>>()
        .mockRejectedValueOnce(new Error("HTTP 500"))
        .mockResolvedValueOnce(OPTIONS);
      render(<Harness search={search} retryText="Retry" />);
      fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "Asha" } });

      await screen.findByRole("alert");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1]![0]).toBe("Asha");
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("has no Retry button unless retryText is given (every existing caller is unchanged)", async () => {
      render(<Harness search={vi.fn(async () => { throw new Error("boom"); })} />);
      fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "x" } });
      await screen.findByRole("alert");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("a caller that sets BOTH searchRetryLabel and retryText gets exactly one retry button (the inline one)", async () => {
      render(<Harness search={vi.fn(async () => { throw new Error("boom"); })} searchErrorText="Could not load the list." searchRetryLabel="Try again" retryText="Retry" />);
      fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "x" } });
      const alert = await screen.findByRole("alert");
      expect(screen.getAllByRole("button")).toHaveLength(1);
      expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("reports the failed state to the form: true after a failed search, false once a later one succeeds", async () => {
      const seen: boolean[] = [];
      const search = vi
        .fn<(q: string, s: AbortSignal) => Promise<EntityOption[]>>()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(OPTIONS);
      render(<Harness search={search} retryText="Retry" onFailedChange={(f) => seen.push(f)} />);
      expect(seen).toEqual([false]);
      fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "As" } });
      await screen.findByRole("alert");
      expect(seen[seen.length - 1]).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await screen.findByText("Asha Rao");
      expect(seen[seen.length - 1]).toBe(false);
    });
  });
});
