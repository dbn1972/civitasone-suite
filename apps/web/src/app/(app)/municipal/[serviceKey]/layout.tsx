import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ModuleGate } from "../../ModuleGate";
import { getMunicipalService } from "../_data/services";

export default function MunicipalServiceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { serviceKey: string };
}) {
  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  return <ModuleGate moduleKey={config.moduleKey}>{children}</ModuleGate>;
}
