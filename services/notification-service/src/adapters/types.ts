export type SendParams = {
  recipient: string;
  subject?: string | null;
  body: string;
  variables?: Record<string, string>;
  /** Required for in_app Redis channel `notifications:{tenantId}:{userId}`. */
  tenantId?: string;
  /** Defaults to `recipient` when omitted. */
  userId?: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export interface ChannelAdapter {
  readonly type: string;
  send(params: SendParams): Promise<SendResult>;
}
