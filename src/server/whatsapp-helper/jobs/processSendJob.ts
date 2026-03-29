import type { WhatsAppHelperProvider } from "../types/contracts";
import type { ProcessSendJobResult, WhatsAppSendJob } from "../types/jobs";
import { renderWhatsAppJobMessage } from "../templates";

export async function processSendJob(
  provider: WhatsAppHelperProvider,
  job: WhatsAppSendJob,
): Promise<ProcessSendJobResult> {
  const renderedMessage = renderWhatsAppJobMessage(job);
  const sendResult = await provider.sendMessage({
    groupNameExact: job.groupNameExact,
    message: renderedMessage,
  });

  return {
    ok: sendResult.ok,
    jobType: job.type,
    groupNameExact: job.groupNameExact,
    processedAt: new Date().toISOString(),
    failureCode: sendResult.failureCode,
  };
}
