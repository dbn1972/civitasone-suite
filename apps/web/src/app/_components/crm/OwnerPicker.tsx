"use client";
/**
 * OwnerPicker — pick a lead/contact owner by NAME, not a hand-typed UUID
 * (GAP-CRM-CONTACTS-DETAIL-01). A mistyped or copied id previously reassigned a
 * lead to nobody or the wrong person; this searches the CRM agent directory and
 * returns the chosen {id, name} so callers can send a real id and show a real
 * name in confirmation dialogs.
 *
 * Built on the generic ds EntityPicker (debounced, cancellable server search).
 * The data source is the same agent-workload directory the assignment screens
 * use (GET /v1/crm/teams/agents, via getAgents()).
 */
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { EntityPicker, type EntityOption } from "../ds";
import { getAgents, type AgentWorkload } from "@/lib/crm/assignment";

export interface Owner {
  id: string;
  name: string;
}

export interface OwnerPickerProps {
  value: Owner | null;
  onChange: (owner: Owner | null) => void;
  "aria-label"?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

function toOption(a: AgentWorkload, onLeaveLabel: string): EntityOption {
  return { id: a.agentId, label: a.name, sublabel: a.onLeave ? onLeaveLabel : undefined };
}

export function OwnerPicker({ value, onChange, disabled, id, placeholder, ...rest }: OwnerPickerProps) {
  const t = useTranslations("crmOwnerPicker");
  const onLeaveLabel = t("onLeave");
  // The directory is small; fetch once and filter client-side per keystroke.
  const search = useCallback(async (query: string): Promise<EntityOption[]> => {
    const { data } = await getAgents();
    const q = query.trim().toLowerCase();
    const matches = q ? data.filter((a) => a.name.toLowerCase().includes(q) || a.agentId.toLowerCase().includes(q)) : data;
    return matches.map((a) => toOption(a, onLeaveLabel));
  }, [onLeaveLabel]);

  const resolve = useCallback(async (ids: string[]): Promise<EntityOption[]> => {
    const { data } = await getAgents();
    return data.filter((a) => ids.includes(a.agentId)).map((a) => toOption(a, onLeaveLabel));
  }, [onLeaveLabel]);

  return (
    <EntityPicker
      value={value?.id ?? null}
      onChange={(next) => {
        const nextId = typeof next === "string" ? next : null;
        if (!nextId) {
          onChange(null);
          return;
        }
        // Resolve the chosen id's label asynchronously; EntityPicker already
        // has it in its own option state, but we re-resolve to carry the name.
        void getAgents().then(({ data }) => {
          const hit = data.find((a) => a.agentId === nextId);
          onChange(hit ? { id: hit.agentId, name: hit.name } : { id: nextId, name: nextId });
        });
      }}
      search={search}
      resolve={resolve}
      {...(value ? { initialOptions: [{ id: value.id, label: value.name }] } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(id !== undefined ? { id } : {})}
      placeholder={placeholder ?? t("searchPlaceholder")}
      minQueryLength={0}
      {...rest}
    />
  );
}
