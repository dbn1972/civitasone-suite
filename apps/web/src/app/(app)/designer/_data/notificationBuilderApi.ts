"use client";

import type {
  NotificationCellBinding,
  NotificationChannel,
  NotificationEvent,
  NotificationsDesignState,
} from "@/app/_components/ds/designer/notificationTypes";
import { emptyNotificationsDesign } from "@/app/_components/ds/designer/notificationTypes";

export interface NotificationBindingsConfig {
  kind: "notifications";
  bindings: {
    event: NotificationEvent;
    channel: NotificationChannel;
    templateId?: string;
    templateName?: string;
    enabled: boolean;
    body: NotificationCellBinding["body"];
    subject?: NotificationCellBinding["subject"];
  }[];
}

interface ApiTemplate {
  id: string;
  name: string;
  channel: string;
  body: string;
  subject?: string | null;
}

async function parseJson(res: Response): Promise<unknown> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

function apiChannel(ch: NotificationChannel): string {
  if (ch === "whatsapp") return "sms";
  return ch;
}

function templateName(serviceKey: string, event: NotificationEvent, channel: NotificationChannel): string {
  return `svc:${serviceKey}:${event}:${channel}`;
}

/** Persist enabled *and* explicitly disabled cells so Off is intentional, not “never set”. */
export function notificationsUiToConfig(design: NotificationsDesignState): NotificationBindingsConfig {
  const bindings: NotificationBindingsConfig["bindings"] = [];
  for (const [event, channels] of Object.entries(design.matrix)) {
    if (!channels) continue;
    for (const [channel, cell] of Object.entries(channels)) {
      if (!cell) continue;
      const hasContent =
        cell.enabled ||
        Boolean(cell.body?.en?.trim() || cell.body?.hi?.trim() || cell.templateId);
      if (!hasContent) continue;
      bindings.push({
        event: event as NotificationEvent,
        channel: channel as NotificationChannel,
        templateId: cell.templateId,
        templateName: cell.templateName,
        enabled: cell.enabled,
        body: cell.body,
        subject: cell.subject,
      });
    }
  }
  return { kind: "notifications", bindings };
}

export function notificationsConfigToUi(
  outputs: unknown[] | undefined | null,
  pattern: string,
): NotificationsDesignState {
  const base = emptyNotificationsDesign(pattern);
  const cfg = (outputs ?? []).find(
    (o): o is NotificationBindingsConfig =>
      typeof o === "object" && o !== null && (o as NotificationBindingsConfig).kind === "notifications",
  );
  if (!cfg?.bindings?.length) return base;

  const matrix = { ...base.matrix };
  for (const b of cfg.bindings) {
    matrix[b.event] = {
      ...matrix[b.event],
      [b.channel]: {
        enabled: b.enabled,
        templateId: b.templateId,
        templateName: b.templateName,
        body: b.body,
        subject: b.subject,
      },
    };
  }
  return { matrix };
}

export function mergeOutputsWithNotifications(
  existing: unknown[] | undefined | null,
  notifications: NotificationBindingsConfig,
): unknown[] {
  const rest = (existing ?? []).filter(
    (o) => !(typeof o === "object" && o !== null && (o as { kind?: string }).kind === "notifications"),
  );
  return [...rest, notifications];
}

export async function persistNotificationTemplates(
  design: NotificationsDesignState,
  serviceKey: string,
): Promise<NotificationsDesignState> {
  let templates: ApiTemplate[] = [];
  try {
    const listRes = await fetch("/api/proxy/v1/notification/templates", { cache: "no-store" });
    if (listRes.ok) {
      templates = (await listRes.json()) as ApiTemplate[];
    }
  } catch {
    return design;
  }

  const nextMatrix = { ...design.matrix };

  for (const [event, channels] of Object.entries(design.matrix)) {
    if (!channels) continue;
    for (const [channel, cell] of Object.entries(channels)) {
      if (!cell?.enabled) continue;
      const ch = channel as NotificationChannel;
      const name = templateName(serviceKey, event as NotificationEvent, ch);
      const existing = templates.find((t) => t.name === name);
      const body = cell.body.en || cell.body.hi;
      if (!body) continue;

      try {
        if (existing) {
          await parseJson(await fetch(`/api/proxy/v1/notification/templates/${existing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              body,
              subject: cell.subject?.en,
            }),
          }));
          nextMatrix[event as NotificationEvent] = {
            ...nextMatrix[event as NotificationEvent],
            [ch]: { ...cell, templateId: existing.id, templateName: name },
          };
        } else {
          const created = (await parseJson(await fetch("/api/proxy/v1/notification/templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              channel: apiChannel(ch),
              name,
              body,
              subject: cell.subject?.en,
            }),
          }))) as { id: string };
          nextMatrix[event as NotificationEvent] = {
            ...nextMatrix[event as NotificationEvent],
            [ch]: { ...cell, templateId: created.id, templateName: name },
          };
        }
      } catch {
        // best-effort — bindings still saved in outputs jsonb
      }
    }
  }

  return { matrix: nextMatrix };
}
