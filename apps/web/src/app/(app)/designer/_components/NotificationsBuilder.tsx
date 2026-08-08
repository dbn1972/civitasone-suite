"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import {
  NotificationMatrix,
  type NotificationsDesignState,
} from "@/app/_components/ds/designer";
import { persistNotificationTemplates } from "../_data/notificationBuilderApi";

interface Props {
  serviceKey: string;
  pattern: string;
  initial: NotificationsDesignState;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: NotificationsDesignState) => void;
}

export function NotificationsBuilder({
  serviceKey,
  pattern,
  initial,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const [design, setDesign] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistNotificationTemplates(latest.current, serviceKey);
        setDesign(saved);
        onDesignPersisted?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onDesignPersisted, onSaveState, serviceKey]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  return (
    <Card title="Notifications">
      <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 0 }}>
        Choose which messages go out at each step. Templates are pre-filled — edit the wording for your office.
      </p>
      <NotificationMatrix
        matrix={design.matrix}
        onChange={setDesign}
      />
    </Card>
  );
}
