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
    expect(screen.getByRole("alert")).toHaveTextContent("The search is unavailable right now. Try again.");
    expect(optionTexts()).toEqual(["Choose…", "Asha Rao", "Ravi Das"]);
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
