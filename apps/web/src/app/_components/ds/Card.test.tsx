import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children content", () => {
    render(<Card><p>Hello world</p></Card>);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders title when provided", () => {
    render(<Card title="My Card"><p>content</p></Card>);
    expect(screen.getByRole("heading", { name: "My Card" })).toBeInTheDocument();
  });

  it("does not render header when title is undefined", () => {
    const { container } = render(<Card><p>content</p></Card>);
    expect(container.querySelector(".card-h")).not.toBeInTheDocument();
  });

  it("renders link in header when provided", () => {
    render(<Card title="My Card" link={<a href="/all">View all</a>}><p>content</p></Card>);
    expect(screen.getByRole("link", { name: "View all" })).toBeInTheDocument();
  });

  it("wraps children in .pad when padding is true", () => {
    const { container } = render(<Card padding><p>padded content</p></Card>);
    expect(container.querySelector(".pad")).toBeInTheDocument();
  });

  it("does not wrap children in .pad when padding is false (default)", () => {
    const { container } = render(<Card><p>no pad</p></Card>);
    expect(container.querySelector(".pad")).not.toBeInTheDocument();
  });
});
