import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RevenueHubPage from "./page";

// GAP-REVENUE-HOME-02 and HOME-03.
describe("Revenue hub", () => {
	it("renders one tile per distinct destination — no two tiles share an href", () => {
		render(<RevenueHubPage />);
		const links = screen.getAllByRole("link");
		const hrefs = links.map((l) => l.getAttribute("href"));
		const revenueHrefs = hrefs.filter((h): h is string => !!h && h.startsWith("/revenue"));
		expect(new Set(revenueHrefs).size).toBe(revenueHrefs.length);
		// The duplicate "Collection Report" tile is gone.
		expect(screen.queryByRole("link", { name: /Collection Report/ })).not.toBeInTheDocument();
	});

	it("groups tiles under labelled sections", () => {
		const { container } = render(<RevenueHubPage />);
		const sectionHeadings = Array.from(container.querySelectorAll(".lt-section-hd")).map(
			(el) => el.textContent,
		);
		expect(sectionHeadings).toEqual([
			"Register",
			"Billing & Collection",
			"Adjustments",
			"Recovery & Config",
			"Insight",
		]);
	});

	it("gives every tile a non-fallback icon (no shared folder glyph)", () => {
		const { container } = render(<RevenueHubPage />);
		const iconBoxes = Array.from(container.querySelectorAll(".ic"));
		expect(iconBoxes).toHaveLength(14);
		for (const box of iconBoxes) {
			// StatIcon renders either a vector <svg> (mapped glyph) or the raw
			// glyph as text; either way it must never be the "📁" fallback that
			// previously made all 15 tiles indistinguishable.
			expect(box.textContent).not.toBe("📁");
			const hasIcon = box.querySelector("svg") !== null || (box.textContent ?? "").length > 0;
			expect(hasIcon).toBe(true);
		}
	});
});
