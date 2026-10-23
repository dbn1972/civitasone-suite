import type { ReactNode } from "react";
import { ProjectDetailNav } from "./ProjectDetailNav";

/**
 * GAP-PROJECTS-DETAIL-06: a shared layout for the project detail route group
 * ([id]/overview, [id]/tasks, [id]/members, [id]/risks). Renders the
 * route-based tab strip above {children} so the active sub-page is always
 * highlighted without each page repeating the navigation markup.
 *
 * The layout is server-rendered; only the nav component itself is a client
 * component (it needs usePathname for active-tab detection).
 */
export default async function ProjectDetailLayout(
  props: {
    children: ReactNode;
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  return (
    <>
      <ProjectDetailNav projectId={params.id} />
      {children}
    </>
  );
}
