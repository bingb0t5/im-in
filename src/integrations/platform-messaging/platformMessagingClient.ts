import { invokeAuthedFunction } from '../../lib/functions';

export type PlatformMessagingBetaStatus = {
  enabled: boolean;
  featureKey: 'host_whatsapp_messaging';
  updatedAt: string | null;
};

export type PlatformMessagingOwnerScope = {
  ownerApp: 'im_in';
  ownerWorkspaceId: string;
  ownerUserId: string;
};

export type PlatformMessagingEngineState =
  | 'provisioning'
  | 'preparing_browser'
  | 'awaiting_qr'
  | 'connecting'
  | 'connected'
  | 'runtime_failed'
  | 'reauth_required'
  | 'disconnected'
  | 'failed';

export type PlatformMessagingEngineStatus = {
  engineId: string;
  lane: string;
  workspaceId: string | null;
  ownerUserId: string | null;
  label: string;
  flowState: PlatformMessagingEngineState;
  lastError: string | null;
  lastHealthState: string | null;
  lastHealthReason: string | null;
  qrAvailable: boolean;
  qrLastAvailableAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatformMessagingEngineQr = {
  engineId: string;
  flowState: PlatformMessagingEngineState;
  qrAvailable: boolean;
  qrDataUrl: string | null;
  qrLastAvailableAt: string | null;
  updatedAt: string;
};

export type PlatformMessagingEngineHandoff = {
  handoffId: string;
  code: string;
  status: 'pending' | 'claimed' | 'expired' | 'completed';
  expiresAt: string;
  engineId: string;
  ownerApp: string;
  ownerWorkspaceId: string;
  ownerUserId: string;
  metadata: {
    appName: string;
    appLogoUrl: string | null;
    themeColor: string | null;
    contextLabel: string | null;
    returnUrl: string | null;
  };
};

export type PlatformMessagingTarget = {
  id: string;
  owner_app: string;
  owner_workspace_id: string | null;
  owner_user_id: string | null;
  label: string;
  engine_id: string;
  whatsapp_group_ref: string | null;
  invite_url: string | null;
  status: 'pending' | 'ready' | 'failed';
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PlatformMessagingScheduledMessage = {
  id: string;
  event_id?: string;
  target_id: string;
  platform_message_id?: string;
  platform_target_id?: string;
  message_body: string;
  scheduled_for: string;
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';
  last_error?: string | null;
  sent_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type PlatformMessagingActivitySettings = {
  event_id: string;
  host_user_id: string;
  platform_target_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
} | null;

export type PlatformMessagingStatus = {
  beta: PlatformMessagingBetaStatus;
  event: {
    id: string;
    title: string | null;
  };
  ownerScope: PlatformMessagingOwnerScope;
  activitySettings: PlatformMessagingActivitySettings;
  latestEngine: PlatformMessagingEngineStatus | null;
  latestEngineError: string | null;
  targets: PlatformMessagingTarget[];
  messages: PlatformMessagingScheduledMessage[];
};

export type PlatformMessagingEngineResponse = {
  engine: PlatformMessagingEngineStatus | null;
  ownerScope: PlatformMessagingOwnerScope;
};

export type PlatformMessagingQrResponse = {
  qr: PlatformMessagingEngineQr;
  ownerScope: PlatformMessagingOwnerScope;
};

export type PlatformMessagingHandoffResponse = {
  handoff: PlatformMessagingEngineHandoff;
  showQrUrl: string;
  ownerScope: PlatformMessagingOwnerScope;
};

export type PlatformMessagingTargetResponse = {
  target: PlatformMessagingTarget;
  ownerScope: PlatformMessagingOwnerScope;
};

export type PlatformMessagingScheduledMessageResponse = {
  message: PlatformMessagingScheduledMessage;
  activityMessage?: PlatformMessagingScheduledMessage | null;
  ownerScope: PlatformMessagingOwnerScope;
};

export type PlatformMessagingActivitySettingsResponse = {
  activitySettings: NonNullable<PlatformMessagingActivitySettings>;
  ownerScope: PlatformMessagingOwnerScope;
};

export const platformMessagingClient = {
  getBetaStatus() {
    return invokeAuthedFunction<PlatformMessagingBetaStatus>('platform-messaging', {
      action: 'betaStatus',
    });
  },

  getStatus(eventId: string) {
    return invokeAuthedFunction<PlatformMessagingStatus>('platform-messaging', {
      action: 'status',
      eventId,
    });
  },

  getLatestEngine(eventId: string) {
    return invokeAuthedFunction<PlatformMessagingEngineResponse>('platform-messaging', {
      action: 'getLatestEngine',
      eventId,
    });
  },

  createEngine(eventId: string, label?: string | null) {
    return invokeAuthedFunction<PlatformMessagingEngineResponse>('platform-messaging', {
      action: 'createEngine',
      eventId,
      label: label || null,
    });
  },

  getEngineQr(eventId: string, engineId: string) {
    return invokeAuthedFunction<PlatformMessagingQrResponse>('platform-messaging', {
      action: 'getEngineQr',
      eventId,
      engineId,
    });
  },

  reconnectEngine(eventId: string, engineId: string) {
    return invokeAuthedFunction<PlatformMessagingEngineResponse>('platform-messaging', {
      action: 'reconnectEngine',
      eventId,
      engineId,
    });
  },

  disconnectEngine(eventId: string, engineId: string) {
    return invokeAuthedFunction<PlatformMessagingEngineResponse>('platform-messaging', {
      action: 'disconnectEngine',
      eventId,
      engineId,
    });
  },

  startQrHandoff(eventId: string, engineId: string, returnUrl?: string | null) {
    return invokeAuthedFunction<PlatformMessagingHandoffResponse>('platform-messaging', {
      action: 'startQrHandoff',
      eventId,
      engineId,
      returnUrl: returnUrl || null,
    });
  },

  createTarget(eventId: string, engineId: string, label: string, inviteUrl?: string | null) {
    return invokeAuthedFunction<PlatformMessagingTargetResponse>('platform-messaging', {
      action: 'createTarget',
      eventId,
      engineId,
      label,
      inviteUrl: inviteUrl || null,
    });
  },

  createScheduledMessage(eventId: string, targetId: string, messageBody: string, scheduledFor: string) {
    return invokeAuthedFunction<PlatformMessagingScheduledMessageResponse>('platform-messaging', {
      action: 'createScheduledMessage',
      eventId,
      targetId,
      messageBody,
      scheduledFor,
    });
  },

  sendMessageNow(eventId: string, targetId: string, messageBody: string) {
    return invokeAuthedFunction<PlatformMessagingScheduledMessageResponse>('platform-messaging', {
      action: 'sendMessageNow',
      eventId,
      targetId,
      messageBody,
    });
  },

  saveActivitySettings(eventId: string, enabled: boolean, targetId?: string | null) {
    return invokeAuthedFunction<PlatformMessagingActivitySettingsResponse>('platform-messaging', {
      action: 'saveActivitySettings',
      eventId,
      enabled,
      targetId: targetId || null,
    });
  },
};
