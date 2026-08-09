import { PageHeader } from "../../_components/ds";
import { HRHubNavigation } from "./_components/HRHubNavigation";
import { hrCategories } from "./_data";

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Human Resources" subtitle="People operations — employees, leave, attendance, payroll, and more." help="hr" />
			<HRHubNavigation categories={hrCategories} />
		</main>
	);
}
