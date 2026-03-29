import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  createPlaywrightWhatsAppHelperProvider,
  processJoinJob,
  processSendJob,
  type WhatsAppFailureCode,
  type WhatsAppSendJob,
} from "./index";

type HelperAccountRow = {
  id: string;
  label: string;
  status: "online" | "connecting" | "offline" | "degraded";
  session_required: boolean;
  last_health_state: "online" | "connecting" | "offline" | "degraded" | null;
  last_health_reason: string | null;
  last_health_checked_at: string | null;
};

type EventWhatsAppGroupRow = {
  id: string;
  helper_account_id: string;
  event_id: string;
  invite_url: string;
  group_name_exact: string | null;
  join_status: "pending_join" | "joined" | "inactive" | "failed";
};

type WhatsAppJoinJobRow = {
  id: string;
  helper_account_id: string;
  event_whatsapp_group_id: string;
  invite_url: string;
  status: "queued" | "processing" | "joined" | "failed" | "cancelled";
  attempt_count: number;
};

type WhatsAppSendJobRow = {
  id: string;
  helper_account_id: string;
  event_whatsapp_group_id: string;
  job_type: "send_test" | "send_disclosure" | "send_manual_post" | "send_capacity_update";
  payload_json: Record<string, unknown> | null;
  status: "queued" | "processing" | "sent" | "failed" | "cancelled";
  attempt_count: number;
};

const helperLabel = process.env.WHATSAPP_HELPER_ACCOUNT_LABEL || "primary-helper";
const pollIntervalMs = Number(process.env.WHATSAPP_WORKER_POLL_INTERVAL_MS || 3000);
const healthIntervalMs = Number(process.env.WHATSAPP_WORKER_HEALTH_INTERVAL_MS || 15000);
const offlineBackoffMs = Number(process.env.WHATSAPP_WORKER_OFFLINE_BACKOFF_MS || 5000);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadText(payload: Record<string, unknown> | null, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildSendJob(
  jobRow: WhatsAppSendJobRow,
  groupNameExact: string,
): { ok: true; job: WhatsAppSendJob } | { ok: false; failureCode: WhatsAppFailureCode; message: string } {
  const payload = jobRow.payload_json || {};

  if (jobRow.job_type === "send_test") {
    return {
      ok: true,
      job: {
        type: "send_test",
        groupNameExact,
        label: payloadText(payload, "label"),
      },
    };
  }

  if (jobRow.job_type === "send_disclosure") {
    return {
      ok: true,
      job: {
        type: "send_disclosure",
        groupNameExact,
        disclosureText: payloadText(payload, "disclosureText"),
        helperName: payloadText(payload, "helperName"),
      },
    };
  }

  if (jobRow.job_type === "send_manual_post") {
    const activityTitle = payloadText(payload, "activityTitle");
    const activityUrl = payloadText(payload, "activityUrl");
    if (!activityTitle || !activityUrl) {
      return {
        ok: false,
        failureCode: "SEND_FAILED",
        message: "send_manual_post payload requires activityTitle and activityUrl.",
      };
    }

    return {
      ok: true,
      job: {
        type: "send_manual_post",
        groupNameExact,
        activityTitle,
        activityUrl,
        summary: payloadText(payload, "summary"),
        startsAtLabel: payloadText(payload, "startsAtLabel"),
        locationLabel: payloadText(payload, "locationLabel"),
      },
    };
  }

  if (jobRow.job_type === "send_capacity_update") {
    const activityTitle = payloadText(payload, "activityTitle");
    const spotsRemainingLabel = payloadText(payload, "spotsRemainingLabel");
    if (!activityTitle || !spotsRemainingLabel) {
      return {
        ok: false,
        failureCode: "SEND_FAILED",
        message: "send_capacity_update payload requires activityTitle and spotsRemainingLabel.",
      };
    }

    return {
      ok: true,
      job: {
        type: "send_capacity_update",
        groupNameExact,
        activityTitle,
        spotsRemainingLabel,
        activityUrl: payloadText(payload, "activityUrl"),
      },
    };
  }

  return {
    ok: false,
    failureCode: "SEND_FAILED",
    message: `Unsupported send job type: ${String(jobRow.job_type)}`,
  };
}

async function ensureHelperAccount(supabase: SupabaseClient): Promise<HelperAccountRow> {
  const { data, error } = await supabase
    .from("whatsapp_helper_accounts")
    .select("*")
    .eq("label", helperLabel)
    .maybeSingle<HelperAccountRow>();

  if (error) {
    throw new Error(error.message || "Could not load WhatsApp helper account.");
  }

  if (data) {
    return data;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("whatsapp_helper_accounts")
    .insert({
      label: helperLabel,
      status: "offline",
      session_required: false,
    })
    .select("*")
    .single<HelperAccountRow>();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || "Could not create WhatsApp helper account.");
  }

  return inserted;
}

async function claimNextJoinJob(supabase: SupabaseClient): Promise<WhatsAppJoinJobRow | null> {
  const { data, error } = await supabase.rpc("claim_next_whatsapp_join_job");
  if (error) {
    throw new Error(error.message || "Could not claim next WhatsApp join job.");
  }
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  return data[0] as WhatsAppJoinJobRow;
}

async function claimNextSendJob(supabase: SupabaseClient): Promise<WhatsAppSendJobRow | null> {
  const { data, error } = await supabase.rpc("claim_next_whatsapp_send_job");
  if (error) {
    throw new Error(error.message || "Could not claim next WhatsApp send job.");
  }
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  return data[0] as WhatsAppSendJobRow;
}

async function loadEventWhatsAppGroup(supabase: SupabaseClient, groupId: string) {
  const { data, error } = await supabase
    .from("event_whatsapp_groups")
    .select("*")
    .eq("id", groupId)
    .single<EventWhatsAppGroupRow>();

  if (error || !data) {
    throw new Error(error?.message || "Could not load event WhatsApp group.");
  }

  return data;
}

async function markJoinJobFailed(
  supabase: SupabaseClient,
  jobRow: WhatsAppJoinJobRow,
  failureCode: WhatsAppFailureCode,
  message: string,
) {
  await supabase
    .from("whatsapp_join_jobs")
    .update({
      status: "failed",
      last_error_code: failureCode,
      last_error_message: message,
      processed_at: new Date().toISOString(),
    })
    .eq("id", jobRow.id);

  await supabase
    .from("event_whatsapp_groups")
    .update({
      join_status: "failed",
      last_error_code: failureCode,
    })
    .eq("id", jobRow.event_whatsapp_group_id);
}

async function processJoinQueue(
  supabase: SupabaseClient,
  provider: ReturnType<typeof createPlaywrightWhatsAppHelperProvider>,
): Promise<boolean> {
  const joinJob = await claimNextJoinJob(supabase);
  if (!joinJob) {
    return false;
  }

  try {
    const group = await loadEventWhatsAppGroup(supabase, joinJob.event_whatsapp_group_id);
    const result = await processJoinJob(provider, {
      type: "join_group",
      inviteUrl: joinJob.invite_url || group.invite_url,
    });

    if (!result.ok || !result.groupNameExact) {
      await markJoinJobFailed(
        supabase,
        joinJob,
        result.failureCode || "UNKNOWN",
        `Join failed (${result.failureCode || "UNKNOWN"})`,
      );
      return true;
    }

    await supabase
      .from("whatsapp_join_jobs")
      .update({
        status: "joined",
        group_name_exact: result.groupNameExact,
        last_error_code: null,
        last_error_message: null,
        processed_at: result.processedAt,
      })
      .eq("id", joinJob.id);

    await supabase
      .from("event_whatsapp_groups")
      .update({
        group_name_exact: result.groupNameExact,
        join_status: "joined",
        last_joined_at: result.processedAt,
        last_error_code: null,
      })
      .eq("id", joinJob.event_whatsapp_group_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected join queue failure.";
    await markJoinJobFailed(supabase, joinJob, "UNKNOWN", message);
  }

  return true;
}

async function markSendJobFailed(
  supabase: SupabaseClient,
  jobRow: WhatsAppSendJobRow,
  failureCode: WhatsAppFailureCode,
  message: string,
) {
  await supabase
    .from("whatsapp_send_jobs")
    .update({
      status: "failed",
      last_error_code: failureCode,
      last_error_message: message,
      processed_at: new Date().toISOString(),
    })
    .eq("id", jobRow.id);
}

async function processSendQueue(
  supabase: SupabaseClient,
  provider: ReturnType<typeof createPlaywrightWhatsAppHelperProvider>,
): Promise<boolean> {
  const sendJobRow = await claimNextSendJob(supabase);
  if (!sendJobRow) {
    return false;
  }

  try {
    const group = await loadEventWhatsAppGroup(supabase, sendJobRow.event_whatsapp_group_id);
    if (!group.group_name_exact || group.join_status !== "joined") {
      await markSendJobFailed(
        supabase,
        sendJobRow,
        "GROUP_NOT_FOUND",
        "Group mapping has not been joined yet.",
      );
      return true;
    }

    const built = buildSendJob(sendJobRow, group.group_name_exact);
    if (built.ok === false) {
      await markSendJobFailed(supabase, sendJobRow, built.failureCode, built.message);
      return true;
    }

    const result = await processSendJob(provider, built.job);
    if (!result.ok) {
      await markSendJobFailed(
        supabase,
        sendJobRow,
        result.failureCode || "UNKNOWN",
        `Send failed (${result.failureCode || "UNKNOWN"})`,
      );
      return true;
    }

    await supabase
      .from("whatsapp_send_jobs")
      .update({
        status: "sent",
        last_error_code: null,
        last_error_message: null,
        processed_at: result.processedAt,
      })
      .eq("id", sendJobRow.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected send queue failure.";
    await markSendJobFailed(supabase, sendJobRow, "UNKNOWN", message);
  }

  return true;
}

async function syncHelperHealth(
  supabase: SupabaseClient,
  helperAccountId: string,
  provider: ReturnType<typeof createPlaywrightWhatsAppHelperProvider>,
) {
  const health = await provider.getHealth();
  const sessionRequired = health.reason === "SESSION_EXPIRED";

  await supabase
    .from("whatsapp_helper_accounts")
    .update({
      status: health.state,
      session_required: sessionRequired,
      last_health_state: health.state,
      last_health_reason: health.reason,
      last_health_checked_at: health.lastCheckedAt,
    })
    .eq("id", helperAccountId);
}

async function runWorker() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const provider = createPlaywrightWhatsAppHelperProvider();

  const helperAccount = await ensureHelperAccount(supabase);

  let running = true;
  const shutdown = async () => {
    running = false;
    await provider.close().catch(() => undefined);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  let nextHealthAt = 0;

  while (running) {
    const now = Date.now();
    if (now >= nextHealthAt) {
      await syncHelperHealth(supabase, helperAccount.id, provider).catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown health sync failure.";
        console.error("[whatsapp-worker] health sync error:", message);
      });
      nextHealthAt = now + healthIntervalMs;
    }

    let processedWork = false;
    processedWork = (await processJoinQueue(supabase, provider)) || processedWork;
    processedWork = (await processSendQueue(supabase, provider)) || processedWork;

    if (!processedWork) {
      await sleep(pollIntervalMs);
    }

    const health = await provider.getHealth().catch(() => ({
      state: "offline" as const,
      reason: "HELPER_OFFLINE",
      lastCheckedAt: new Date().toISOString(),
    }));
    if (health.state === "offline" || health.state === "degraded") {
      await sleep(offlineBackoffMs);
    }
  }

  await provider.close().catch(() => undefined);
}

void runWorker().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown worker boot failure.";
  console.error("[whatsapp-worker] fatal:", message);
  process.exitCode = 1;
});
