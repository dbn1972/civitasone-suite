/**
 * Shared assessee-type vocabulary (GAP-REVENUE-ASSESSEES-02).
 *
 * One source of truth for the four assessee types the backend accepts
 * (assessee.assessees.assessee_type), with human labels. Used by the create
 * form, the register table's Type column, and anywhere a raw enum like
 * "water_connection" would otherwise leak to a clerk.
 */
export const ASSESSEE_TYPES = [
	{ value: "property", label: "Property" },
	{ value: "water_connection", label: "Water Connection" },
	{ value: "trade", label: "Trade" },
	{ value: "other", label: "Other" },
] as const;

export type AssesseeTypeValue = (typeof ASSESSEE_TYPES)[number]["value"];

const LABEL_BY_VALUE = new Map<string, string>(ASSESSEE_TYPES.map((t) => [t.value, t.label]));

/**
 * Human label for an assessee-type enum value. Unknown values fall back to a
 * title-cased version of the raw value (so a new backend type never renders as
 * a blank), rather than hiding it.
 */
export function labelForType(value: string | null | undefined): string {
	if (!value) return "—";
	const known = LABEL_BY_VALUE.get(value);
	if (known) return known;
	return value
		.split("_")
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(" ");
}
