"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import {
  NotificationMatrix,
  type NotificationsDesignState,
} from "@/app/_components/ds/designer";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import { persistNotificationTemplates } from "../_data/notificationBuilderApi";
import {
  defaultSampleValues,
  matrixCompleteness,
  mergeFieldsForNotifications,
  sampleFormDesignFromFields,
  summarizeDesign,
} from "../_data/notificationBuilderModel";

interface Props {
  serviceKey: string;
  serviceName?: string;
  pattern: string;
  formFields?: FormFieldDefinition[];
  initial: NotificationsDesignState;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: NotificationsDesignState) => void;
}

export function NotificationsBuilder({
  serviceKey,
  serviceName = "Service",
  pattern,
  formFields = [],
  initial,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [sampleValues, setSampleValues] = useState(() => defaultSampleValues(serviceName));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  useEffect(() => {
    setSampleValues((prev) => ({ ...prev, service_name: serviceName }));
  }, [serviceName]);

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

  const mergeFields = useMemo(() => mergeFieldsForNotifications(formFields), [formFields]);
  const sampleFormDesign = useMemo(
    () => sampleFormDesignFromFields(formFields, serviceName),
    [formFields, serviceName],
  );
  const completeness = useMemo(
    () => matrixCompleteness(design.matrix, pattern),
    [design.matrix, pattern],
  );
  const summary = useMemo(() => summarizeDesign(design, pattern), [design, pattern]);

  return (
    <Card title="Notifications">
      <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 0 }}>
        Choose which messages go out at each step. Templates are pre-filled for this service pattern —
        edit the wording for your office. Click an On cell to edit; use <strong>Turn off this channel</strong>{" "}
        to disable.
      </p>
      <p
        data-testid="notifications-summary"
        style={{
          fontSize: 12,
          margin: "0 0 12px",
          padding: "8px 10px",
          borderRadius: "var(--r-sm)",
          background: completeness.localesComplete ? "var(--good-bg)" : "var(--bg)",
          border: `1px solid ${completeness.localesComplete ? "var(--good-border)" : "var(--line)"}`,
          color: "var(--ink2)",
        }}
      >
        {summary}
        {!completeness.localesComplete && completeness.enabledCount > 0 ? (
          <span style={{ display: "block", marginTop: 4, color: "var(--warn-fg)" }}>
            Some enabled messages are missing Hindi or English — fill both locale tabs before submit.
          </span>
        ) : null}
      </p>
      <NotificationMatrix
        matrix={design.matrix}
        onChange={(matrix) => setDesign({ matrix })}
        pattern={pattern}
        mergeFields={mergeFields}
        sampleFormDesign={sampleFormDesign}
        sampleValues={sampleValues}
        onSampleValuesChange={setSampleValues}
      />
    </Card>
  );
}
