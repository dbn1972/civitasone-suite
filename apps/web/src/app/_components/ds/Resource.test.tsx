import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Resource } from "./Resource";
import type { ResourceState } from "@/app/_data/useResource";

describe("Resource", () => {
  it("renders the error slot and not the empty slot or children when status=error", () => {
    const resource: ResourceState<string[]> = { status: "error", data: [], source: "error" };
    render(
      <Resource resource={resource} error={<p>load failed</p>} empty={<p>nothing here</p>}>
        {(data) => <p>{data.join(",")}</p>}
      </Resource>,
    );
    expect(screen.getByText("load failed")).toBeInTheDocument();
    expect(screen.queryByText("nothing here")).not.toBeInTheDocument();
  });

  it("renders the empty slot and not the error slot or children when status=empty", () => {
    const resource: ResourceState<string[]> = { status: "empty", data: [], source: "api" };
    render(
      <Resource resource={resource} error={<p>load failed</p>} empty={<p>nothing here</p>}>
        {(data) => <p>{data.join(",")}</p>}
      </Resource>,
    );
    expect(screen.getByText("nothing here")).toBeInTheDocument();
    expect(screen.queryByText("load failed")).not.toBeInTheDocument();
  });

  it("renders children with the real data when status=ready, not the error or empty slot", () => {
    const resource: ResourceState<string[]> = { status: "ready", data: ["a", "b"], source: "api" };
    render(
      <Resource resource={resource} error={<p>load failed</p>} empty={<p>nothing here</p>}>
        {(data) => <p>{data.join(",")}</p>}
      </Resource>,
    );
    expect(screen.getByText("a,b")).toBeInTheDocument();
    expect(screen.queryByText("load failed")).not.toBeInTheDocument();
    expect(screen.queryByText("nothing here")).not.toBeInTheDocument();
  });
});
