export type EventVisibility = 'public' | 'semi_public' | 'private';

export type ModerationRiskLevel = 'low' | 'medium' | 'high';
export type ModerationAction = 'allow' | 'limit_visibility' | 'require_review' | 'block';
export type ModerationStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'limited'
  | 'review'
  | 'blocked'
  | 'error';
export type ModerationOverride = 'force_visible' | 'force_limited' | 'hide' | 'mark_safe' | 'mark_spam';
export type HostTrustLevel = 'new' | 'established' | 'trusted';

export type EventModerationShape = {
  title?: string | null;
  description?: string | null;
  public_summary?: string | null;
  location_text?: string | null;
  public_location_text?: string | null;
  host_name?: string | null;
  visibility?: EventVisibility | null;
  is_public?: boolean | null;
  moderation_status?: ModerationStatus | null;
  moderation_risk_level?: ModerationRiskLevel | null;
  moderation_action?: ModerationAction | null;
  moderation_confidence?: number | null;
  moderation_reasons?: string[] | null;
  moderation_input_hash?: string | null;
  moderated_at?: string | null;
  moderation_archived_at?: string | null;
  moderation_override?: ModerationOverride | null;
  public_discovery_enabled?: boolean | null;
};

export type ActivityModerationInput = {
  title: string;
  description: string;
  publicSummary: string;
  location: string;
  publicLocation: string;
  hostName: string;
  visibility: Exclude<EventVisibility, 'private'>;
};

export type ActivityModerationResult = {
  risk_level: ModerationRiskLevel;
  recommended_action: ModerationAction;
  reasons: string[];
  confidence: number;
};

export function normalizeVisibility(event: Pick<EventModerationShape, 'visibility' | 'is_public'>): EventVisibility {
  if (event.visibility === 'public' || event.visibility === 'semi_public' || event.visibility === 'private') {
    return event.visibility;
  }
  return event.is_public ? 'public' : 'private';
}

function normalizeText(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function shouldModerateVisibility(visibility: EventVisibility) {
  return visibility === 'public' || visibility === 'semi_public';
}

export function buildActivityModerationInput(event: EventModerationShape): ActivityModerationInput | null {
  const visibility = normalizeVisibility(event);
  if (!shouldModerateVisibility(visibility)) return null;

  return {
    title: normalizeText(event.title),
    description: normalizeText(event.description),
    publicSummary: normalizeText(event.public_summary),
    location: normalizeText(event.location_text),
    publicLocation: normalizeText(event.public_location_text),
    hostName: normalizeText(event.host_name),
    visibility,
  };
}

export function buildModerationHash(input: ActivityModerationInput) {
  const canonical = JSON.stringify(input);
  let hash = 2166136261;

  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

export function getModerationBannerCopy(event: EventModerationShape) {
  const visibility = normalizeVisibility(event);
  if (!shouldModerateVisibility(visibility)) return null;

  if (event.public_discovery_enabled) return null;

  switch (event.moderation_status) {
    case 'pending':
      return {
        title: 'Broader public discovery is still unlocking',
        body: 'This activity is saved, but it is not available for broader public discovery yet.',
      };
    case 'limited':
      return {
        title: 'Broader public discovery is limited for now',
        body: "Try sharing this activity with your own groups first and build a little engagement there.",
      };
    case 'review':
      return {
        title: 'This listing needs a quick review',
        body: 'It is saved and shareable by direct link, but it is not available for broader public discovery yet.',
      };
    case 'blocked':
      return {
        title: 'This listing is not available for broader public discovery',
        body: 'It is saved and shareable by direct link, but it is not appearing more widely right now.',
      };
    case 'error':
      return {
        title: 'Broader public discovery is not available yet',
        body: 'The activity is saved, but discovery is still limited for now.',
      };
    default:
      return null;
  }
}

export function getModerationStatusBadge(event: EventModerationShape) {
  const visibility = normalizeVisibility(event);
  if (!shouldModerateVisibility(visibility)) return null;

  if (event.public_discovery_enabled) {
    return {
      label: 'Public discovery on',
      className: 'bg-brand-50 text-brand-700 border border-brand-100',
    };
  }

  switch (event.moderation_status) {
    case 'pending':
      return {
        label: 'Discovery unlocking',
        className: 'bg-slate-100 text-slate-600 border border-slate-200',
      };
    case 'limited':
      return {
        label: 'Limited for now',
        className: 'bg-amber-50 text-amber-700 border border-amber-100',
      };
    case 'review':
      return {
        label: 'Needs review',
        className: 'bg-slate-100 text-slate-700 border border-slate-200',
      };
    case 'blocked':
      return {
        label: 'Not in wider discovery',
        className: 'bg-slate-100 text-slate-700 border border-slate-200',
      };
    case 'error':
      return {
        label: 'Discovery not available yet',
        className: 'bg-slate-100 text-slate-600 border border-slate-200',
      };
    default:
      return null;
  }
}
