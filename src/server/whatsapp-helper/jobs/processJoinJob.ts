import type { WhatsAppHelperProvider } from "../types/contracts";
import type { ProcessJoinJobResult, WhatsAppJoinGroupJob } from "../types/jobs";

export async function processJoinJob(
  provider: WhatsAppHelperProvider,
  job: WhatsAppJoinGroupJob,
): Promise<ProcessJoinJobResult> {
  const joinResult = await provider.joinGroupByInviteLink({
    inviteUrl: job.inviteUrl,
  });

  return {
    ok: joinResult.ok,
    jobType: job.type,
    processedAt: new Date().toISOString(),
    groupNameExact: joinResult.groupNameExact,
    failureCode: joinResult.failureCode,
  };
}
