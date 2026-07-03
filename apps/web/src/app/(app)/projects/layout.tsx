import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="projects">{children}</ModuleGate>;
}
