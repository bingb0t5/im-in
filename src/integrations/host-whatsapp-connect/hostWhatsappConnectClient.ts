import { invokeAuthedFunction } from '../../lib/functions';

type HostWhatsappConnectFlowState =
  | 'idle'
  | 'opening'
  | 'entering_phone'
  | 'awaiting_code'
  | 'connected'
  | 'expired'
  | 'failed';

export type HostWhatsappBetaStatus = {
  enabled: boolean;
  featureKey: string;
  phoneNumberMasked: string | null;
  hasWhatsAppTestNumber: boolean;
  updatedAt: string | null;
};

export type HostWhatsappConnectStatus = {
  helperAccountId: string;
  helperLabel: string;
  flowState: HostWhatsappConnectFlowState;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string;
  phoneNumberMasked: string | null;
  linkCode: string | null;
  instructions: string[];
  sessionRequired: boolean;
};

export type HostWhatsappConnectCode = {
  helperAccountId: string;
  helperLabel: string;
  flowState: HostWhatsappConnectFlowState;
  phoneNumberMasked: string | null;
  linkCode: string;
  instructions: string[];
  updatedAt: string;
};

export const hostWhatsappConnectClient = {
  getBetaStatus() {
    return invokeAuthedFunction<HostWhatsappBetaStatus>('host-whatsapp-connect', {
      action: 'betaStatus',
    });
  },

  start() {
    return invokeAuthedFunction<{
      ok?: boolean;
      helperAccountId: string;
      helperLabel: string;
      flowState: HostWhatsappConnectFlowState;
      lastError: string | null;
      startedAt: string | null;
      updatedAt: string;
      phoneNumberMasked: string | null;
    }>('host-whatsapp-connect', {
      action: 'start',
    });
  },

  getStatus() {
    return invokeAuthedFunction<HostWhatsappConnectStatus>('host-whatsapp-connect', {
      action: 'status',
    });
  },

  getCode() {
    return invokeAuthedFunction<HostWhatsappConnectCode>('host-whatsapp-connect', {
      action: 'code',
    });
  },
};
