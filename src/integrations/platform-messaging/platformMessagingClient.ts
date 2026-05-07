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

export type PlatformMessagingStatus = {
  beta: PlatformMessagingBetaStatus;
  event: {
    id: string;
    title: string | null;
  };
  ownerScope: PlatformMessagingOwnerScope;
  latestEngine: PlatformMessagingEngineStatus | null;
  latestEngineError: string | null;
  targets: unknown[];
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
};
