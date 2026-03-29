import type {
  WhatsAppSendCapacityUpdateJob,
  WhatsAppSendDisclosureJob,
  WhatsAppSendJob,
  WhatsAppSendManualPostJob,
  WhatsAppSendTestJob,
} from "./types/jobs";

function joinLines(lines: Array<string | undefined>): string {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function renderTestMessage(job: WhatsAppSendTestJob): string {
  const label = job.label ? ` (${job.label.trim()})` : "";

  return joinLines([
    `I’m In WhatsApp Helper test${label}`,
    `Time: ${new Date().toISOString()}`,
    "This is an outbound system test message.",
  ]);
}

function renderDisclosureMessage(job: WhatsAppSendDisclosureJob): string {
  return joinLines([
    job.disclosureText ??
      `${job.helperName ?? "I’m In"} may post activity updates to this group using a dedicated outbound-only helper account.`,
    "This helper is not a chatbot, does not monitor replies, and should not be treated as the source of truth.",
    "Please use I’m In for the latest activity details.",
  ]);
}

function renderManualPostMessage(job: WhatsAppSendManualPostJob): string {
  return joinLines([
    `Activity update: ${job.activityTitle}`,
    job.summary,
    job.startsAtLabel ? `Starts: ${job.startsAtLabel}` : undefined,
    job.locationLabel ? `Location: ${job.locationLabel}` : undefined,
    `Details: ${job.activityUrl}`,
  ]);
}

function renderCapacityUpdateMessage(job: WhatsAppSendCapacityUpdateJob): string {
  return joinLines([
    `Capacity update: ${job.activityTitle}`,
    `Availability: ${job.spotsRemainingLabel}`,
    job.activityUrl ? `Details: ${job.activityUrl}` : undefined,
  ]);
}

export function renderWhatsAppJobMessage(job: WhatsAppSendJob): string {
  switch (job.type) {
    case "send_test":
      return renderTestMessage(job);
    case "send_disclosure":
      return renderDisclosureMessage(job);
    case "send_manual_post":
      return renderManualPostMessage(job);
    case "send_capacity_update":
      return renderCapacityUpdateMessage(job);
  }
}
