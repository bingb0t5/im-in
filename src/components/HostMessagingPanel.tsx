import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Loader2, MessageCircle, RefreshCcw, Send, Settings, Unplug, Users } from 'lucide-react';
import { Event } from '../types';
import { Button } from './ui/Button';
import {
  platformMessagingClient,
  type PlatformMessagingEngineStatus,
  type PlatformMessagingScheduledMessage,
  type PlatformMessagingTarget,
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
  return state === 'preparing_browser' || state === 'awaiting_qr' || state === 'reauth_required';
}

function isEngineBusy(state?: PlatformMessagingEngineStatus['flowState'] | null) {
  return state === 'provisioning' || state === 'preparing_browser' || state === 'connecting';
}

function isEngineConnected(state?: PlatformMessagingEngineStatus['flowState'] | null) {
  return state === 'connected';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

export function HostMessagingPanel({ event }: HostMessagingPanelProps) {
  const [betaChecked, setBetaChecked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [engine, setEngine] = useState<PlatformMessagingEngineStatus | null>(null);
  const [targets, setTargets] = useState<PlatformMessagingTarget[]>([]);
  const [messages, setMessages] = useState<PlatformMessagingScheduledMessage[]>([]);
  const [activityEnabled, setActivityEnabled] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [savedTargetId, setSavedTargetId] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [handoffCode, setHandoffCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [groupLabel, setGroupLabel] = useState('');
  const [groupInviteUrl, setGroupInviteUrl] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const handoffStartedForRef = useRef<string | null>(null);

  const readyTargets = targets.filter((target) => target.status === 'ready');
  const selectedTarget = targets.find((target) => target.id === selectedTargetId);
  const canCreateTarget = isEngineConnected(engine?.flowState) && groupLabel.trim().length > 0 && groupInviteUrl.trim().length > 0;
  const canSaveActivity = !activityEnabled || (selectedTarget?.status === 'ready' && selectedTargetId.length > 0);
  const hasSavedActivityTarget = activityEnabled && selectedTargetId.length > 0 && selectedTargetId === savedTargetId;
  const canSendMessage = hasSavedActivityTarget && selectedTarget?.status === 'ready' && messageBody.trim().length > 0;
  const canScheduleMessage = canSendMessage && scheduledFor.trim().length > 0;

  const loadStatus = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
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
      const settingTargetId = status.activitySettings?.platform_target_id || '';
      setEngine(status.latestEngine);
      setTargets(status.targets || []);
      setMessages(status.messages || []);
      setActivityEnabled(status.activitySettings?.enabled === true);
      setSelectedTargetId(settingTargetId);
      setSavedTargetId(settingTargetId);
      setShowSetup((previous) => previous || !status.latestEngine || !isEngineConnected(status.latestEngine.flowState) || (status.targets || []).length === 0);
    } catch (statusError) {
      setBetaChecked(true);
      setError(statusError instanceof Error ? statusError.message : 'Could not load WhatsApp messaging status.');
    } finally {
      if (!options?.silent) setLoading(false);
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
    setNotice(null);
    try {
      const response = await action();
      setEngine(response.engine);
      setHandoffUrl(null);
      setHandoffCode(null);
      setShowSetup(true);
      handoffStartedForRef.current = null;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update WhatsApp connection.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartHandoff = async (options?: { automatic?: boolean }) => {
    if (!engine) return;
    const handoffKey = `${engine.engineId}:${engine.flowState}`;
    if (options?.automatic && handoffStartedForRef.current === handoffKey) return;
    setActionLoading('handoff');
    setError(null);
    try {
      const response = await platformMessagingClient.startQrHandoff(event.id, engine.engineId, window.location.href);
      setHandoffUrl(response.showQrUrl);
      setHandoffCode(response.handoff.code);
      handoffStartedForRef.current = handoffKey;
    } catch (handoffError) {
      setError(handoffError instanceof Error ? handoffError.message : 'Could not start QR handoff.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateTarget = async () => {
    if (!engine) return;
    setActionLoading('create-target');
    setError(null);
    setNotice(null);
    try {
      const response = await platformMessagingClient.createTarget(event.id, engine.engineId, groupLabel, groupInviteUrl);
      setTargets((previous) => [response.target, ...previous.filter((target) => target.id !== response.target.id)]);
      setGroupLabel('');
      setGroupInviteUrl('');
      setNotice('Group import queued. Refresh this panel to check when it is ready.');
      await loadStatus({ silent: true });
    } catch (targetError) {
      setError(targetError instanceof Error ? targetError.message : 'Could not add WhatsApp group.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveActivitySettings = async () => {
    setActionLoading('save-activity');
    setError(null);
    setNotice(null);
    try {
      const response = await platformMessagingClient.saveActivitySettings(event.id, activityEnabled, activityEnabled ? selectedTargetId : null);
      setActivityEnabled(response.activitySettings.enabled);
      setSelectedTargetId(response.activitySettings.platform_target_id || '');
      setSavedTargetId(response.activitySettings.platform_target_id || '');
      setNotice(response.activitySettings.enabled ? 'WhatsApp messaging enabled for this activity.' : 'WhatsApp messaging disabled for this activity.');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Could not save activity WhatsApp settings.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateMessage = async (sendNow: boolean) => {
    setActionLoading(sendNow ? 'send-now' : 'schedule-message');
    setError(null);
    setNotice(null);
    try {
      if (sendNow) {
        await platformMessagingClient.sendMessageNow(event.id, selectedTargetId, messageBody);
        setNotice('Update queued to send now.');
      } else {
        await platformMessagingClient.createScheduledMessage(event.id, selectedTargetId, messageBody, new Date(scheduledFor).toISOString());
        setNotice('Automated message scheduled.');
      }
      setMessageBody('');
      setScheduledFor('');
      await loadStatus({ silent: true });
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : 'Could not save message.');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    if (!engine || !isQrRelevant(engine.flowState) || handoffCode || actionLoading === 'handoff') return;
    void handleStartHandoff({ automatic: true });
  }, [engine?.engineId, engine?.flowState, handoffCode, actionLoading]);

  useEffect(() => {
    if (!engine || isEngineConnected(engine.flowState) || engine.flowState === 'failed' || engine.flowState === 'disconnected') return;
    const intervalId = window.setInterval(() => {
      void loadStatus({ silent: true });
    }, 4_000);
    return () => window.clearInterval(intervalId);
  }, [engine?.engineId, engine?.flowState]);

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
          <p className="mt-1 text-xs text-slate-500">Enable automatic WhatsApp messaging for this activity and choose one of your host groups.</p>
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Host WhatsApp setup</p>
            <div className="mt-1 flex items-center gap-2">
              {isEngineBusy(engine?.flowState) ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : null}
              <p className="text-sm font-bold capitalize text-slate-800">{engineStateLabel(engine?.flowState)}</p>
            </div>
            {engine?.updatedAt ? <p className="mt-1 text-xs text-slate-400">Updated {formatDateTime(engine.updatedAt)}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => setShowSetup((previous) => !previous)}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"
          >
            <Settings className="h-3.5 w-3.5" />
            {showSetup ? 'Hide Setup' : 'Manage'}
          </button>
        </div>
        {engine?.lastError ? <p className="mt-2 text-xs text-red-500">{engine.lastError}</p> : null}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">
          {notice}
        </div>
      ) : null}

      {showSetup ? (
        <section className="mt-4 space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!engine ? (
              <Button
                onClick={() => void runEngineAction('create', () => platformMessagingClient.createEngine(event.id, "I'm In WhatsApp"))}
                loading={actionLoading === 'create'}
                leadingIcon={<MessageCircle className="h-4 w-4" />}
              >
                Set Up WhatsApp
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
              </>
            )}
          </div>

          {handoffCode && handoffUrl ? (
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
              <p className="text-xs font-bold text-brand-700">Go to {handoffUrl} on another screen and enter this code:</p>
              <p className="mt-2 text-2xl font-black tracking-[0.24em] text-slate-900">{handoffCode}</p>
              <p className="mt-2 text-xs text-slate-600">That screen will show the WhatsApp QR as soon as the hosted browser is ready.</p>
            </div>
          ) : null}

          {isEngineConnected(engine?.flowState) ? (
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-brand-600" />
                <p className="text-sm font-black text-slate-900">Your WhatsApp Groups</p>
              </div>
              <div className="mt-3 grid gap-2">
                <input
                  value={groupLabel}
                  onChange={(inputEvent) => setGroupLabel(inputEvent.target.value)}
                  placeholder="Group name"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-brand-500"
                />
                <input
                  value={groupInviteUrl}
                  onChange={(inputEvent) => setGroupInviteUrl(inputEvent.target.value)}
                  placeholder="WhatsApp group invite link"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-brand-500"
                />
                <Button
                  onClick={() => void handleCreateTarget()}
                  loading={actionLoading === 'create-target'}
                  disabled={!canCreateTarget}
                  leadingIcon={<Users className="h-4 w-4" />}
                >
                  Add Group To My WhatsApp Setup
                </Button>
              </div>
              {targets.length ? (
                <div className="mt-3 space-y-2">
                  {targets.map((target) => (
                    <div key={target.id} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                      <p className="font-bold text-slate-800">{target.label}</p>
                      <p className="capitalize">Status: {target.status}</p>
                      {target.last_error ? <p className="text-red-500">{target.last_error}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-black text-slate-900">This Activity</p>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-800">
          Enable automatic WhatsApp messaging
          <input
            type="checkbox"
            checked={activityEnabled}
            onChange={(checkboxEvent) => setActivityEnabled(checkboxEvent.target.checked)}
            className="h-4 w-4"
          />
        </label>
        <select
          value={selectedTargetId}
          onChange={(selectEvent) => setSelectedTargetId(selectEvent.target.value)}
          disabled={!activityEnabled}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-brand-500 disabled:opacity-60"
        >
          <option value="">Select one of your ready WhatsApp groups</option>
          {readyTargets.map((target) => (
            <option key={target.id} value={target.id}>{target.label}</option>
          ))}
        </select>
        {!readyTargets.length ? (
          <p className="mt-2 text-xs text-slate-500">No ready groups yet. Use Manage to connect WhatsApp and add a group.</p>
        ) : null}
        <Button
          className="mt-3"
          onClick={() => void handleSaveActivitySettings()}
          loading={actionLoading === 'save-activity'}
          disabled={!canSaveActivity}
          leadingIcon={<Settings className="h-4 w-4" />}
        >
          Save Activity Messaging
        </Button>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-black text-slate-900">Group Updates</p>
        </div>
        <textarea
          value={messageBody}
          onChange={(textareaEvent) => setMessageBody(textareaEvent.target.value)}
          placeholder="Write an update for the selected group"
          rows={3}
          className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-brand-500"
        />
        <input
          type="datetime-local"
          value={scheduledFor}
          onChange={(inputEvent) => setScheduledFor(inputEvent.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-brand-500"
        />
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            onClick={() => void handleCreateMessage(true)}
            loading={actionLoading === 'send-now'}
            disabled={!canSendMessage}
            leadingIcon={<Send className="h-4 w-4" />}
          >
            Send Update Now
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleCreateMessage(false)}
            loading={actionLoading === 'schedule-message'}
            disabled={!canScheduleMessage}
            leadingIcon={<CalendarClock className="h-4 w-4" />}
          >
            Schedule Message
          </Button>
        </div>
        {!activityEnabled ? <p className="mt-2 text-xs text-slate-500">Enable this activity before sending WhatsApp updates.</p> : null}
        {activityEnabled && selectedTargetId !== savedTargetId ? (
          <p className="mt-2 text-xs text-slate-500">Save the selected group before sending updates.</p>
        ) : null}
        {messages.length ? (
          <div className="mt-3 space-y-2">
            {messages.slice(0, 5).map((scheduledMessage) => (
              <div key={scheduledMessage.id} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                <p className="font-bold text-slate-800">{scheduledMessage.message_body}</p>
                <p className="capitalize">{scheduledMessage.status} · {formatDateTime(scheduledMessage.scheduled_for)}</p>
                {scheduledMessage.last_error ? <p className="text-red-500">{scheduledMessage.last_error}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}
