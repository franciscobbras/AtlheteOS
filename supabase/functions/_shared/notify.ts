// Shared ops.notifications writer for the ingestion Edge Functions.
//
// No Postgres-side state table backs the retry ceilings (Task 2) — the
// pg_cron schedule itself already encodes "retry every N min, up to a
// ceiling" (see 20260730000001_pg_cron_schedule.sql: fixed retry minute
// lists for hr, a fixed early/retry/final sequence for hrv/spo2). Each
// invocation is stateless; it only needs to recognise whether *this* tick
// is the schedule's last chance, using the wall clock, and write at most
// once per incident via notifyOnce's dedupe check.

// deno-lint-ignore no-explicit-any
type Client = any;

export type NotifyType = "reauth_required" | "ingestion_failure" | "data_missing";
export type Severity = "info" | "warning" | "error";

export interface NotifyArgs {
  type: NotifyType;
  severity: Severity;
  title: string;
  detail?: string;
  // deno-lint-ignore no-explicit-any
  context?: Record<string, any>;
  // Distinguishes concurrent open incidents of the same `type` (e.g. per
  // series+day). Stored inside `context.dedupe_key`. Omit only when a single
  // type should ever have at most one open notification system-wide
  // (reauth_required: one broken refresh token affects every series alike).
  dedupeKey?: string;
}

// Insert unless an unresolved notification for the same (type, dedupeKey)
// is already open — cron ticks every few minutes and must not spam the
// table while an incident is ongoing. The human's "mark resolved" (Task 4)
// is what allows a fresh notification for a *new* incident of the same kind.
export async function notifyOnce(client: Client, args: NotifyArgs): Promise<void> {
  const { data: open, error: selErr } = await client
    .schema("ops")
    .from("notifications")
    .select("id, context")
    .eq("type", args.type)
    .eq("resolved", false);
  if (selErr) throw new Error(`ler ops.notifications falhou: ${selErr.message}`);

  const rows: Array<{ context: Record<string, unknown> | null }> = open ?? [];
  const alreadyOpen = args.dedupeKey
    ? rows.some((r) => r.context?.["dedupe_key"] === args.dedupeKey)
    : rows.length > 0;
  if (alreadyOpen) return;

  const { error } = await client.schema("ops").from("notifications").insert({
    type: args.type,
    severity: args.severity,
    title: args.title,
    detail: args.detail ?? null,
    context: { ...(args.context ?? {}), ...(args.dedupeKey ? { dedupe_key: args.dedupeKey } : {}) },
  });
  if (error) throw new Error(`escrever ops.notifications falhou: ${error.message}`);
}

// Auto-close an open incident once its cause clears (e.g. a data_missing whose
// data the API produced late and a reconciliation pass has now pulled). Matches
// on the same dedupe_key notifyOnce used. Best-effort: caller wraps in .catch.
//
// Filtering is done in JS (select open rows, match context.dedupe_key, update by
// id) rather than via a `context->>dedupe_key` PostgREST filter, which supabase-js
// does not encode reliably — the same select-then-match pattern notifyOnce uses.
export async function resolveByDedupe(client: Client, type: NotifyType, dedupeKey: string): Promise<void> {
  const { data: open, error: selErr } = await client
    .schema("ops")
    .from("notifications")
    .select("id, context")
    .eq("type", type)
    .eq("resolved", false);
  if (selErr) throw new Error(`ler ops.notifications falhou: ${selErr.message}`);

  const ids = ((open ?? []) as Array<{ id: string; context: Record<string, unknown> | null }>)
    .filter((r) => r.context?.["dedupe_key"] === dedupeKey)
    .map((r) => r.id);
  if (!ids.length) return;

  const { error } = await client
    .schema("ops")
    .from("notifications")
    .update({ resolved: true, resolved_at_utc: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(`resolver ops.notifications falhou: ${error.message}`);
}
