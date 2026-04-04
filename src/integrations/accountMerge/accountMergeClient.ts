import { invokeAuthedFunction } from '../../lib/functions';

export type StartAccountMergeResponse = {
  started: true;
  request_id: string;
  target_email: string;
  expires_at: string;
};

export type CompleteAccountMergeResponse = {
  merged: true;
  target_user_id: string;
  target_email: string;
  profile_id: string;
};

export const accountMergeClient = {
  start(email: string) {
    return invokeAuthedFunction<StartAccountMergeResponse>('merge-account', {
      action: 'start',
      email,
    });
  },

  complete(requestId: string) {
    return invokeAuthedFunction<CompleteAccountMergeResponse>('merge-account', {
      action: 'complete',
      request_id: requestId,
    });
  },
};
