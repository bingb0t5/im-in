import { X } from 'lucide-react';
import {
  getProfileDisplayName,
  type GuestAutoClaimResult,
  type GuestAutoClaimReason,
} from '../services/guestService';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { Button } from './ui/Button';

type GuestProfileMergePromptModalProps = {
  open: boolean;
  result: GuestAutoClaimResult | null;
  mergeLoading?: boolean;
  mergeError?: string | null;
  preferredNameSource: 'guest' | 'signed_in';
  onPreferredNameSourceChange: (value: 'guest' | 'signed_in') => void;
  onMerge: () => void;
  onKeepSeparate: () => void;
};

function formatHistoryHint(result: GuestAutoClaimResult['guestHistory']) {
  if (!result) return 'No saved activity history yet.';

  const parts: string[] = [];
  if (result.attendeeCount > 0) {
    parts.push(`${result.attendeeCount} joined`);
  }
  if (result.joinRequestCount > 0) {
    parts.push(`${result.joinRequestCount} requested`);
  }
  if (result.interestCount > 0) {
    parts.push(`${result.interestCount} interested`);
  }
  if (result.accessRequestCount > 0) {
    parts.push(`${result.accessRequestCount} access request${result.accessRequestCount === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'No saved activity history yet.';
}

function formatReasonCopy(reasons: GuestAutoClaimReason[]) {
  if (reasons.includes('name_conflict') && reasons.includes('target_has_history')) {
    return 'We found a remembered guest profile on this device and your signed-in account already has activity history, so we need your confirmation before combining them.';
  }
  if (reasons.includes('name_conflict')) {
    return 'We found a remembered guest profile on this device, but the names do not match closely enough for a silent merge.';
  }
  return 'We found a remembered guest profile on this device, and your signed-in account already has activity history, so we need your confirmation before combining them.';
}

export function GuestProfileMergePromptModal({
  open,
  result,
  mergeLoading = false,
  mergeError,
  preferredNameSource,
  onPreferredNameSourceChange,
  onMerge,
  onKeepSeparate,
}: GuestProfileMergePromptModalProps) {
  useBodyScrollLock(open);

  if (!open || !result) return null;

  const guestName = getProfileDisplayName(result.guestProfile).trim() || 'Guest account on this device';
  const signedInName = getProfileDisplayName(result.targetProfile).trim() || 'Signed-in account';
  const shouldChooseName = result.reasons.includes('name_conflict');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close merge prompt"
        onClick={onKeepSeparate}
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
      />
      <div className="relative my-4 max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <button
          type="button"
          onClick={onKeepSeparate}
          className="absolute right-4 top-4 rounded-xl p-2 text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="ui-eyebrow">Account continuity</p>
        <h2 className="mt-1 pr-8 text-2xl font-black tracking-tight text-slate-900">Merge this remembered guest profile?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {formatReasonCopy(result.reasons)}
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">Guest on this device</p>
            <p className="mt-1 text-base font-black text-slate-900">{guestName}</p>
            <p className="mt-2 text-xs text-slate-600">{formatHistoryHint(result.guestHistory)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Signed-in account</p>
            <p className="mt-1 text-base font-black text-slate-900">{signedInName}</p>
            <p className="mt-2 text-xs text-slate-600">{formatHistoryHint(result.targetHistory)}</p>
          </div>
        </div>

        {shouldChooseName ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Display name to keep</p>
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-3 py-3">
                <input
                  type="radio"
                  name="merge-name-choice"
                  value="signed_in"
                  checked={preferredNameSource === 'signed_in'}
                  onChange={() => onPreferredNameSourceChange('signed_in')}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span>
                  <span className="block text-sm font-bold text-slate-900">{signedInName}</span>
                  <span className="block text-xs text-slate-500">Keep the signed-in account name.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-3 py-3">
                <input
                  type="radio"
                  name="merge-name-choice"
                  value="guest"
                  checked={preferredNameSource === 'guest'}
                  onChange={() => onPreferredNameSourceChange('guest')}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span>
                  <span className="block text-sm font-bold text-slate-900">{guestName}</span>
                  <span className="block text-xs text-slate-500">Use the remembered guest name after merging.</span>
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {mergeError ? <p className="mt-4 ui-feedback ui-feedback-error">{mergeError}</p> : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            fullWidth={false}
            className="w-full sm:flex-1"
            onClick={onKeepSeparate}
          >
            Keep separate for now
          </Button>
          <Button
            type="button"
            fullWidth={false}
            className="w-full sm:flex-1"
            loading={mergeLoading}
            onClick={onMerge}
          >
            Merge profiles
          </Button>
        </div>
      </div>
    </div>
  );
}
