import { useEffect, useState } from 'react';
import { ExternalLink, MessageCircle, QrCode, RefreshCcw, Unplug } from 'lucide-react';
import { Event } from '../types';
import { Button } from './ui/Button';
import {
  platformMessagingClient,
  type PlatformMessagingEngineQr,
  type PlatformMessagingEngineStatus,
} from '../integrations/platform-messaging/platformMessagingClient';

type HostMessagingPanelProps = {
  event: Event;
};

function engineStateLabel(state?: PlatformMessagingEngineStatus['flowState'] | null) {
  if (!state) return 'Not connected';
  if (state === 'awaiting_qr') return 'Waiting for QR scan';
  if (state === 'preparing_browser') return 'Preparing browser';
  if (state === 'reauth_required') return 'Reconnect needed';
  return state.replace(/_/g, ' ');
}

function isQrRelevant(state?: PlatformMessagingEngineStatus['flowState'] | null) {
  return state === 'awaiting_qr' || state === 'reauth_required';
}

export function HostMessagingPanel({ event }: HostMessagingPanelProps) {
  const [betaChecked, setBetaChecked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [engine, setEngine] = useState<PlatformMessagingEngineStatus | null>(null);
  const [qr, setQr] = useState<PlatformMessagingEngineQr | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [handoffCode, setHandoffCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const beta = await platformMessagingClient.getBetaStatus();
      setEnabled(beta.enabled);
      setBetaChecked(true);
      if (!beta.enabled) {
        setEngine(null);
        return;
      }
      const status = await platformMessagingClient.getStatus(event.id);
      setEngine(status.latestEngine);
    } catch (statusError) {
      setBetaChecked(true);
      setError(statusError instanceof Error ? statusError.message : 'Could not load WhatsApp messaging status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [event.id]);

  const runEngineAction = async (
    key: string,
    action: () => Promise<{ engine: PlatformMessagingEngineStatus | null }>,
  ) => {
    setActionLoading(key);
    setError(null);
    try {
      const response = await action();
      setEngine(response.engine);
      setQr(null);
      setHandoffUrl(null);
      setHandoffCode(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update WhatsApp connection.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleLoadQr = async () => {
    if (!engine) return;
    setActionLoading('qr');
    setError(null);
    try {
      const response = await platformMessagingClient.getEngineQr(event.id, engine.engineId);
      setQr(response.qr);
    } catch (qrError) {
      setError(qrError instanceof Error ? qrError.message : 'QR is not ready yet.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartHandoff = async () => {
    if (!engine) return;
    setActionLoading('handoff');
    setError(null);
    try {
      const response = await platformMessagingClient.startQrHandoff(event.id, engine.engineId, window.location.href);
      setHandoffUrl(response.showQrUrl);
      setHandoffCode(response.handoff.code);
      window.open(response.showQrUrl, '_blank', 'noopener,noreferrer');
    } catch (handoffError) {
      setError(handoffError instanceof Error ? handoffError.message : 'Could not start QR handoff.');
    } finally {
      setActionLoading(null);
    }
  };

  if (!betaChecked && loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-black tracking-tight text-brand-600">WhatsApp Messaging</p>
        <p className="mt-2 text-sm text-slate-500">Checking host messaging access...</p>
      </section>
    );
  }

  if (!enabled) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black tracking-tight text-brand-600">WhatsApp Messaging</p>
          <p className="mt-1 text-xs text-slate-500">
            Connect the hosted WhatsApp engine for this activity. Group import and scheduled sends come next.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-all hover:bg-slate-100 disabled:opacity-50"
          aria-label="Refresh WhatsApp messaging status"
        >
          <RefreshCcw className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-50 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Engine status</p>
        <p className="mt-1 text-sm font-bold capitalize text-slate-800">{engineStateLabel(engine?.flowState)}</p>
        {engine?.lastError ? <p className="mt-1 text-xs text-red-500">{engine.lastError}</p> : null}
        {engine?.updatedAt ? <p className="mt-1 text-xs text-slate-400">Updated {new Date(engine.updatedAt).toLocaleString()}</p> : null}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!engine ? (
          <Button
            onClick={() =>
              void runEngineAction('create', () => platformMessagingClient.createEngine(event.id, event.title || 'Activity messaging'))
            }
            loading={actionLoading === 'create'}
            leadingIcon={<MessageCircle className="h-4 w-4" />}
          >
            Create WhatsApp Engine
          </Button>
        ) : (
          <>
            <Button
              onClick={() => void runEngineAction('reconnect', () => platformMessagingClient.reconnectEngine(event.id, engine.engineId))}
              loading={actionLoading === 'reconnect'}
              leadingIcon={<RefreshCcw className="h-4 w-4" />}
            >
              Reconnect
            </Button>
            <Button
              variant="secondary"
              onClick={() => void runEngineAction('disconnect', () => platformMessagingClient.disconnectEngine(event.id, engine.engineId))}
              loading={actionLoading === 'disconnect'}
              leadingIcon={<Unplug className="h-4 w-4" />}
            >
              Disconnect
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleLoadQr()}
              loading={actionLoading === 'qr'}
              disabled={!isQrRelevant(engine.flowState)}
              leadingIcon={<QrCode className="h-4 w-4" />}
            >
              Show QR Here
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleStartHandoff()}
              loading={actionLoading === 'handoff'}
              disabled={!isQrRelevant(engine.flowState)}
              leadingIcon={<ExternalLink className="h-4 w-4" />}
            >
              Open QR On Another Screen
            </Button>
          </>
        )}
      </div>

      {qr?.qrDataUrl ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold text-slate-600">Scan this QR from WhatsApp Linked Devices.</p>
          <img src={qr.qrDataUrl} alt="WhatsApp QR code" className="mx-auto mt-3 w-full max-w-xs rounded-xl border border-slate-100" />
        </div>
      ) : null}

      {handoffCode && handoffUrl ? (
        <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50 p-4">
          <p className="text-xs font-bold text-brand-700">Open {handoffUrl} on another screen and enter this code:</p>
          <p className="mt-2 text-2xl font-black tracking-[0.24em] text-slate-900">{handoffCode}</p>
        </div>
      ) : null}
    </section>
  );
}
