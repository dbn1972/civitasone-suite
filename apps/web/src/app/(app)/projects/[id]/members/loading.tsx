// GAP-PROJECTS-DETAIL-RISKS-05: members/ had no loading.tsx and inherited the
// generic [id] detail skeleton, causing a layout jump. The members page is a
// header + (role-gated) Add card + a team table — no stat tiles.
export default function MembersLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-6">
        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="h-8 w-52 rounded bg-slate-200" />
        </div>
        <div className="h-28 rounded-xl bg-slate-200" />
        <div className="h-72 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
