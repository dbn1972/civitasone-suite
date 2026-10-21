import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState, type ComponentProps } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import * as aa from "@/lib/crm/activityAccount";
import { DirectoryUserSelect } from "./DirectoryUserSelect";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, searchEscalationUsers: vi.fn() };
});
const search = vi.mocked(aa.searchEscalationUsers);

const BASE = [
  { id: "u-1", name: "Asha Rao" },
  { id: "u-2", name: "Ravi Das" },
];

type Extra = Partial<ComponentProps<typeof DirectoryUserSelect>> & { initial?: string };
function Harness({ initial = "", ...props }: Extra) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="pick">Person</label>
      <DirectoryUserSelect id="pick" value={value} onChange={setValue} users={BASE} leading={<option value="">Choose…</option>} {...props} />
    </>
  );
}

const optionTexts = () => Array.from((screen.getByLabelText("Person") as HTMLSelectElement).options).map((o) => o.textContent);
const selected = () => (screen.getByLabelText("Person") as HTMLSelectElement).value;
const searchBox = () => screen.getByRole("searchbox", { name: "Search people by name" });

/** Type into the search box and let the debounce + the (mocked) request settle. */
async function typeAndSettle(text: string) {
  fireEvent.change(searchBox(), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DirectoryUserSelect: a complete directory is just a select", () => {
  it("renders no search box and no note, and lists the users", () => {
    renderWithIntl(<Harness />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(optionTexts()).toEqual(["Choose…", "Asha Rao", "Ravi Das"]);
  });

  it("leaves out the excluded user (e.g. the current owner)", () => {
    renderWithIntl(<Harness excludeId="u-1" />);
    expect(optionTexts()).toEqual(["Choose…", "Ravi Das"]);
  });

  it("keeps a stored id that is not in the list, labelled by the caller (never silently dropped)", () => {
    renderWithIntl(<Harness initial="u-404" unlistedLabel="Unknown user" unlistedTruncatedLabel="Saved user (not listed)" />);
    expect(optionTexts()).toEqual(["Choose…", "Unknown user", "Asha Rao", "Ravi Das"]);
    expect(selected()).toBe("u-404");
  });
});

describe("DirectoryUserSelect: a truncated directory says so and can be searched", () => {
  it("shows how many people are listed and offers a name search", () => {
    renderWithIntl(<Harness truncated />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing the first 2 people. Search by name to find anyone else.");
    expect(searchBox()).toBeInTheDocument();
    expect(optionTexts()).toEqual(["Choose…", "Asha Rao", "Ravi Das"]);
  });

  it("labels a stored id that is not in the loaded page as 'not listed', not 'unknown'", () => {
    renderWithIntl(<Harness truncated initial="u-404" unlistedLabel="Unknown user" unlistedTruncatedLabel="Saved user (not listed)" />);
    expect(optionTexts()).toContain("Saved user (not listed)");
    expect(optionTexts()).not.toContain("Unknown user");
  });

  it("does not ask the server for fewer than 2 characters", async () => {
    renderWithIntl(<Harness truncated />);
    await typeAndSettle("a");
    expect(search).not.toHaveBeenCalled();
    expect(optionTexts()).toEqual(["Choose…", "Asha Rao", "Ravi Das"]);
  });

  it("searches the SERVER (debounced to the final text) and lists the matches instead of the loaded page", async () => {
    search.mockResolvedValue({ data: [{ id: "u-9", name: "Meera Nair" }], source: "api", truncated: false });
    renderWithIntl(<Harness truncated />);
    fireEvent.change(searchBox(), { target: { value: "me" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(searchBox(), { target: { value: "mee" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("mee");
    expect(optionTexts()).toEqual(["Choose…", "Meera Nair"]);
  });

  it("a person picked from the results stays selected, and named, after the search is cleared", async () => {
    search.mockResolvedValue({ data: [{ id: "u-9", name: "Meera Nair" }], source: "api", truncated: false });
    renderWithIntl(<Harness truncated />);
    await typeAndSettle("mee");
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "u-9" } });
    expect(selected()).toBe("u-9");

    await typeAndSettle("");
    expect(selected()).toBe("u-9");
    expect(optionTexts()).toEqual(["Choose…", "Meera Nair", "Asha Rao", "Ravi Das"]);
  });

  it("says when nobody matches", async () => {
    search.mockResolvedValue({ data: [], source: "api", truncated: false });
    renderWithIntl(<Harness truncated />);
    await typeAndSettle("zzz");
    expect(screen.getByRole("status")).toHaveTextContent("No one matches “zzz”.");
    expect(optionTexts()).toEqual(["Choose…"]);
  });

  it("asks the reader to narrow the search when the match list itself hit its cap", async () => {
    search.mockResolvedValue({
      data: Array.from({ length: 20 }, (_, i) => ({ id: `m-${i}`, name: `Match ${String(i).padStart(2, "0")}` })),
      source: "api",
      truncated: true,
    });
    renderWithIntl(<Harness truncated />);
    await typeAndSettle("ma");
    expect(screen.getByRole("status")).toHaveTextContent("Showing the first 20 matches. Type more of the name to narrow the list.");
  });

  it("reports a failed search and keeps the loaded list usable", async () => {
    search.mockResolvedValue({ data: [], source: "error" });
    renderWithIntl(<Harness truncated />);
    await typeAndSettle("me");
    // Announced through the ONE status region (no separate role=alert element is created and torn down).
    expect(screen.getByRole("status")).toHaveTextContent("The search is unavailable right now. Try again.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(optionTexts()).toEqual(["Choose…", "Asha Rao", "Ravi Das"]);
  });

  it("announces how many people a search found (singular and plural)", async () => {
    renderWithIntl(<Harness truncated />);
    search.mockResolvedValueOnce({ data: [{ id: "u-9", name: "Meera Nair" }], source: "api", truncated: false });
    await typeAndSettle("mee");
    expect(screen.getByRole("status")).toHaveTextContent("1 person found");
    search.mockResolvedValueOnce({ data: [{ id: "u-9", name: "Meera Nair" }, { id: "u-8", name: "Meera Rao" }, { id: "u-7", name: "Meeta Das" }], source: "api", truncated: false });
    await typeAndSettle("meer");
    expect(screen.getByRole("status")).toHaveTextContent("3 people found");
  });

  it("keeps exactly ONE status region, the same element, mounted through every phase of a search", async () => {
    let release: (v: Awaited<ReturnType<typeof aa.searchEscalationUsers>>) => void = () => {};
    search.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderWithIntl(<Harness truncated />);
    const region = screen.getByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Showing the first 2 people.");

    fireEvent.change(searchBox(), { target: { value: "me" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByRole("status")).toBe(region); // searching
    expect(region).toHaveTextContent("Searching…");

    await act(async () => {
      release({ data: [{ id: "u-9", name: "Meera Nair" }], source: "api", truncated: false });
    });
    expect(screen.getByRole("status")).toBe(region); // found
    expect(region).toHaveTextContent("1 person found");

    await typeAndSettle(""); // back to idle
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Showing the first 2 people.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("describes the search box by the status region", () => {
    renderWithIntl(<Harness truncated />);
    expect(searchBox()).toHaveAttribute("aria-describedby", screen.getByRole("status").id);
  });

  it("takes the search box's accessible name from the searchLabel prop when one is given", () => {
    renderWithIntl(<Harness truncated searchLabel="Search people by name for rule 3" />);
    expect(screen.getByRole("searchbox", { name: "Search people by name for rule 3" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Search people by name" })).not.toBeInTheDocument();
  });

  it("renders no status region and no search box at all for a complete directory", () => {
    renderWithIntl(<Harness />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("ignores a late answer to an earlier query", async () => {
    let releaseFirst: (v: Awaited<ReturnType<typeof aa.searchEscalationUsers>>) => void = () => {};
    search
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce({ data: [{ id: "u-2b", name: "Second Answer" }], source: "api", truncated: false });
    renderWithIntl(<Harness truncated />);
    await typeAndSettle("fi");
    await typeAndSettle("sec");
    expect(optionTexts()).toEqual(["Choose…", "Second Answer"]);
    await act(async () => {
      releaseFirst({ data: [{ id: "u-1b", name: "First Answer" }], source: "api", truncated: false });
    });
    expect(optionTexts()).toEqual(["Choose…", "Second Answer"]);
  });

  it("does not search at all once the directory is complete (the box is not rendered)", async () => {
    renderWithIntl(<Harness />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(search).not.toHaveBeenCalled();
  });
});
