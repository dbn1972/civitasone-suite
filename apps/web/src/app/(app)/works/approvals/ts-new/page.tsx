import { NewTsForm } from "./NewTsForm";

/**
 * GAP-WORKS-APPROVALS-TS-NEW-01: the work can be prefilled from `?workId=` (e.g. from a DAO-finalized proposal's
 * page) so the clerk does not have to re-find it. Role access is enforced by ./layout.tsx.
 */
export default async function NewTsPage(props: { searchParams?: Promise<{ workId?: string }> }) {
 const searchParams = await props.searchParams;
 const workId = typeof searchParams?.workId === "string" ? searchParams.workId : "";
 return <NewTsForm initialWorkId={workId} />;
}
