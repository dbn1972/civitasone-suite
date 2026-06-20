export default function Page() {
	return (
		<main className="min-h-screen bg-slate-50 p-6 md:p-8">
			<section className="mx-auto max-w-6xl space-y-4">
				<h1 className="text-3xl font-semibold text-slate-900">Developer Portal</h1>
				<p className="text-sm text-slate-600">API docs, plugin SDK guidance, and environment diagnostics.</p>
				<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
					<ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
						<li>API reference publishing pipeline</li>
						<li>Plugin manifest validator</li>
						<li>Sandbox credentials and test tenant bootstrap</li>
					</ul>
				</div>
			</section>
		</main>
	);
}
