import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DarkModeToggle } from "./DarkModeToggle";

describe("DarkModeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("renders a button", () => {
    render(<DarkModeToggle />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("defaults to light theme icon", () => {
    render(<DarkModeToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("☀️");
  });

  it("cycles to dark on first click", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("🌙");
  });

  it("cycles to system on second click", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("💻");
  });

  it("persists theme choice to localStorage", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(localStorage.getItem("civitas-theme")).toBe("dark");
  });

  it("reads initial theme from localStorage", () => {
    localStorage.setItem("civitas-theme", "dark");
    render(<DarkModeToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("🌙");
  });

  it("adds dark class to documentElement in dark mode", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button")); // → dark
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class in light mode", () => {
    document.documentElement.classList.add("dark");
    localStorage.setItem("civitas-theme", "dark");
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button")); // dark → system
    fireEvent.click(screen.getByRole("button")); // system → light
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
