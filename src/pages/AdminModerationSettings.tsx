import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { canAccessModerationAdminFrontend } from '../lib/admin';
import { invokeAuthedFunction } from '../lib/functions';

type StrictnessMode = 'relaxed' | 'balanced' | 'strict';

type ModerationPolicyRules = {
  enable_ai_moderation: boolean;
  enable_trust_relaxation: boolean;
  restrict_for_abuse_or_hate: boolean;
  restrict_for_scam_or_impersonation: boolean;
  restrict_for_mass_posting: boolean;
  restrict_for_not_real_world_activity: boolean;
  restrict_for_low_detail: boolean;
  restrict_for_overly_promotional: boolean;
  restrict_for_other: boolean;
  medium_risk_requires_review: boolean;
  high_risk_requires_review: boolean;
};

type ModerationPolicyThresholds = {
  established_host_min_count: number;
  trusted_host_min_count: number;
  trust_relax_max_confidence: number;
};

type ModerationPolicy = {
  strictness_mode: StrictnessMode;
  rules: ModerationPolicyRules;
  thresholds: ModerationPolicyThresholds;
  updated_at: string | null;
  updated_by_user_id: string | null;
};

const RULE_LABELS: Record<keyof ModerationPolicyRules, { title: string; detail: string }> = {
  enable_ai_moderation: {
    title: 'Enable AI moderation',
    detail: 'Turn off only if you want all public listings approved without AI checks.',
  },
  enable_trust_relaxation: {
    title: 'Allow trust-based relaxation',
    detail: 'Lets established/trusted hosts pass medium/soft flags more easily.',
  },
  restrict_for_abuse_or_hate: {
    title: 'Restrict abuse / hate / foul language',
    detail: 'Hide listings flagged for abuse, hate, illicit or adult-services content.',
  },
  restrict_for_scam_or_impersonation: {
    title: 'Restrict scam / impersonation',
    detail: 'Hide listings flagged as scam-like, misleading identity, or suspicious payment/contact requests.',
  },
  restrict_for_mass_posting: {
    title: 'Restrict mass posting signals',
    detail: 'Hide listings flagged as repeated or bulk posting behavior.',
  },
  restrict_for_not_real_world_activity: {
    title: 'Restrict non-real-world activity',
    detail: 'Hide listings that look unrelated to genuine in-person activities.',
  },
  restrict_for_low_detail: {
    title: 'Restrict low-info listings',
    detail: 'Hide listings that do not include enough useful public detail.',
  },
  restrict_for_overly_promotional: {
    title: 'Restrict overly promotional listings',
    detail: 'Hide listings that read more like promotion than community activities.',
  },
  restrict_for_other: {
    title: 'Restrict generic "other" flags',
    detail: 'Hide listings when moderation can only classify concern as "other".',
  },
  medium_risk_requires_review: {
    title: 'Medium risk requires manual review',
    detail: 'When off, medium-risk outcomes are limited instead of sent to review.',
  },
  high_risk_requires_review: {
    title: 'High risk requires manual review',
    detail: 'When on, high-risk recommendations never stay broadly discoverable.',
  },
};

const MODE_COPY: Record<StrictnessMode, { label: string; detail: string }> = {
  relaxed: {
    label: 'Relaxed',
    detail: 'Lower trust thresholds and a wider confidence window before limiting visibility.',
  },
  balanced: {
    label: 'Balanced',
    detail: 'Current default behavior with trust and moderation checks balanced.',
  },
  strict: {
    label: 'Strict',
    detail: 'Higher trust thresholds and stricter review gating for medium-risk listings.',
  },
};

const PRESET_THRESHOLDS: Record<StrictnessMode, ModerationPolicyThresholds> = {
  relaxed: {
    established_host_min_count: 2,
    trusted_host_min_count: 5,
    trust_relax_max_confidence: 0.9,
  },
  balanced: {
    established_host_min_count: 3,
    trusted_host_min_count: 10,
    trust_relax_max_confidence: 0.75,
  },
  strict: {
    established_host_min_count: 5,
    trusted_host_min_count: 15,
    trust_relax_max_confidence: 0.6,
  },
};

const PRESET_RULES: Record<StrictnessMode, ModerationPolicyRules> = {
  relaxed: {
    enable_ai_moderation: true,
    enable_trust_relaxation: true,
    restrict_for_abuse_or_hate: true,
    restrict_for_scam_or_impersonation: false,
    restrict_for_mass_posting: false,
    restrict_for_not_real_world_activity: false,
    restrict_for_low_detail: false,
    restrict_for_overly_promotional: false,
    restrict_for_other: false,
    medium_risk_requires_review: false,
    high_risk_requires_review: false,
  },
  balanced: {
    enable_ai_moderation: true,
    enable_trust_relaxation: true,
    restrict_for_abuse_or_hate: true,
    restrict_for_scam_or_impersonation: true,
    restrict_for_mass_posting: true,
    restrict_for_not_real_world_activity: true,
    restrict_for_low_detail: false,
    restrict_for_overly_promotional: false,
    restrict_for_other: false,
    medium_risk_requires_review: false,
    high_risk_requires_review: true,
  },
  strict: {
    enable_ai_moderation: true,
    enable_trust_relaxation: false,
    restrict_for_abuse_or_hate: true,
    restrict_for_scam_or_impersonation: true,
    restrict_for_mass_posting: true,
    restrict_for_not_real_world_activity: true,
    restrict_for_low_detail: true,
    restrict_for_overly_promotional: true,
    restrict_for_other: true,
    medium_risk_requires_review: true,
    high_risk_requires_review: true,
  },
};

function normalizeThresholds(next: ModerationPolicyThresholds): ModerationPolicyThresholds {
  const established = Math.max(0, Math.round(Number(next.established_host_min_count) || 0));
  const trusted = Math.max(established, Math.round(Number(next.trusted_host_min_count) || 0));
  const confidence = Math.min(1, Math.max(0, Number(next.trust_relax_max_confidence) || 0));

  return {
    established_host_min_count: established,
    trusted_host_min_count: trusted,
    trust_relax_max_confidence: Number(confidence.toFixed(2)),
  };
}

export default function AdminModerationSettings({ user }: { user: User | null }) {
  const [policy, setPolicy] = useState<ModerationPolicy | null>(null);
  const [draft, setDraft] = useState<ModerationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const isAdmin = canAccessModerationAdminFrontend(user?.email);

  const fetchPolicy = async () => {
    setLoading(true);
    setError(null);
    setSavedMessage(null);

    try {
      const response = await invokeAuthedFunction<{ policy: ModerationPolicy }>('moderate-activity', {
        listPolicy: true,
      });
      setPolicy(response.policy);
      setDraft(response.policy);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load moderation policy.');
      setPolicy(null);
      setDraft(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    void fetchPolicy();
  }, [user?.id, isAdmin]);

  const hasChanges = useMemo(() => {
    if (!policy || !draft) return false;
    return JSON.stringify(policy) !== JSON.stringify(draft);
  }, [policy, draft]);

  const applyPresetLocally = (mode: StrictnessMode) => {
    setDraft((current) => {
      if (!current) return current;

      return {
        ...current,
        strictness_mode: mode,
        rules: PRESET_RULES[mode],
        thresholds: PRESET_THRESHOLDS[mode],
      };
    });
  };

  const savePolicy = async (applyPreset: boolean) => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);

    try {
      const response = await invokeAuthedFunction<{ policy: ModerationPolicy }>('moderate-activity', {
        updatePolicy: {
          strictness_mode: draft.strictness_mode,
          rules: draft.rules,
          thresholds: normalizeThresholds(draft.thresholds),
          apply_preset: applyPreset,
        },
      });
      setPolicy(response.policy);
      setDraft(response.policy);
      setSavedMessage(applyPreset ? 'Preset applied and saved.' : 'Policy saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save moderation policy.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/admin" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Moderation Settings</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Runtime policy controls</span>
          </div>
          <button
            type="button"
            onClick={() => { void fetchPolicy(); }}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all active:scale-95"
            aria-label="Refresh moderation policy"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-6 space-y-5">
        <section className="bg-white rounded-2xl p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
              <SlidersHorizontal className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Live moderation controls</p>
              <p className="text-sm text-slate-500 leading-relaxed mt-1">
                Update moderation strictness and rule toggles without changing code or redeploying.
              </p>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          ) : null}

          {savedMessage ? (
            <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
              {savedMessage}
            </p>
          ) : null}

          {policy?.updated_at ? (
            <p className="text-xs text-slate-400">
              Last updated: {new Date(policy.updated_at).toLocaleString()}
            </p>
          ) : null}
        </section>

        {loading || !draft ? (
          <section className="bg-white rounded-2xl p-6">
            <p className="text-sm text-slate-400">Loading moderation policy…</p>
          </section>
        ) : (
          <>
            <section className="bg-white rounded-2xl p-5 space-y-4">
              <p className="text-sm font-bold text-slate-900">Strictness mode</p>
              <div className="grid gap-3 md:grid-cols-3">
                {(Object.keys(MODE_COPY) as StrictnessMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => applyPresetLocally(mode)}
                    className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                      draft.strictness_mode === mode
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-sm font-bold text-slate-900">{MODE_COPY[mode].label}</p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{MODE_COPY[mode].detail}</p>
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyPresetLocally('relaxed')}
                    disabled={saving}
                    className="px-4 py-2 rounded-full bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    Open except abuse/hate
                  </button>
                  <button
                    type="button"
                    onClick={() => { void savePolicy(true); }}
                    disabled={saving}
                    className="px-4 py-2 rounded-full bg-slate-900 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Apply selected preset'}
                  </button>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl p-5 space-y-4">
              <p className="text-sm font-bold text-slate-900">Rule toggles</p>
              <div className="space-y-3">
                {(Object.keys(RULE_LABELS) as Array<keyof ModerationPolicyRules>).map((ruleKey) => (
                  <label key={ruleKey} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={draft.rules[ruleKey]}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setDraft((current) => current
                          ? {
                            ...current,
                            rules: {
                              ...current.rules,
                              [ruleKey]: checked,
                            },
                          }
                          : current);
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span>
                      <p className="text-sm font-bold text-slate-900">{RULE_LABELS[ruleKey].title}</p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{RULE_LABELS[ruleKey].detail}</p>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="bg-white rounded-2xl p-5 space-y-4">
              <p className="text-sm font-bold text-slate-900">Thresholds</p>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Established host minimum</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.thresholds.established_host_min_count}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setDraft((current) => current
                        ? {
                          ...current,
                          thresholds: normalizeThresholds({
                            ...current.thresholds,
                            established_host_min_count: value,
                          }),
                        }
                        : current);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Trusted host minimum</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.thresholds.trusted_host_min_count}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setDraft((current) => current
                        ? {
                          ...current,
                          thresholds: normalizeThresholds({
                            ...current.thresholds,
                            trusted_host_min_count: value,
                          }),
                        }
                        : current);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Trust relax confidence max</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.thresholds.trust_relax_max_confidence}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setDraft((current) => current
                        ? {
                          ...current,
                          thresholds: normalizeThresholds({
                            ...current.thresholds,
                            trust_relax_max_confidence: value,
                          }),
                        }
                        : current);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all"
                  />
                </label>
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { void savePolicy(false); }}
                disabled={saving || !hasChanges}
                className="px-5 py-2 rounded-full bg-brand-600 text-sm font-bold text-white hover:bg-brand-500 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save custom policy'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
