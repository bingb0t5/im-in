import { ReactNode, useEffect, useMemo, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Eye, MapPin, UserRound, Users } from 'lucide-react';
import { supabase } from '../supabase';
import { formatDate, formatDay, formatTime, isOnOrAfterTodayInTimeZone } from '../utils';
import { Event } from '../types';
import { buildEventPath, withConfirmedCounts } from '../lib/events';
import { BookingRow, groupBookingsByEvent } from '../lib/bookings';
import { AuthPromptModal } from '../components/AuthPromptModal';
import { Card } from '../components/ui/Card';

type JoinedRow = BookingRow & {
  status: string;
  events: Event;
};

type PendingAccessRequestRow = {
  id: string;
  event_id: string;
  requester_name: string;
  created_at: string;
  status: 'pending' | 'approved' | 'declined' | 'contacted';
  events?: { id: string; title: string }[] | { id: string; title: string } | null;
};

type PendingJoinRequestRow = {
  id: string;
  event_id: string;
  guest_name: string;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  events?: { id: string; title: string }[] | { id: string; title: string } | null;
};

type HostedAttendeeCountRow = {
  status: string;
};

type HostedInterestCountRow = {
  id: string;
};

function upcomingOnly(events: Event[]) {
  return events.filter((event) => isOnOrAfterTodayInTimeZone(event.starts_at, event.timezone));
}

function pastOnly(events: Event[]) {
  return events.filter((event) => !isOnOrAfterTodayInTimeZone(event.starts_at, event.timezone));
}

function normalizeEventRef(
  value?: { id: string; title: string }[] | { id: string; title: string } | null,
): { id: string; title: string } | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function getVisibilityMeta(event: Event) {
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');

  if (visibility === 'semi_public') {
    return {
      label: 'Semi public',
      className: 'bg-indigo-50 text-indigo-500',
    };
  }

  if (visibility === 'private') {
    return {
      label: 'Private',
      className: 'bg-slate-100 text-slate-500',
    };
  }

  return {
    label: 'Public',
    className: 'bg-brand-50 text-brand-700',
  };
}

function getPreviewLocation(event: Event) {
  const visibility = event.visibility || (event.is_public ? 'public' : 'private');
  return visibility === 'semi_public'
    ? event.public_location_text || 'Location shared by host'
    : event.location_text || event.public_location_text || '';
}

function ActivityEventList({
  events,
  emptyLabel,
  pathForEvent,
}: {
  events: Event[];
  emptyLabel: string;
  pathForEvent?: (event: Event) => string;
}) {
  if (events.length === 0) {
    return <div className="ui-muted-panel text-sm text-slate-500">{emptyLabel}</div>;
  }

  return (
    <div>
      {events.map((event, index) => (
        (() => {
          const path = pathForEvent ? pathForEvent(event) : buildEventPath(event, { preferPrivateAccess: true });
          const dayOnly = formatDay(event.starts_at, event.timezone);
          const timeOnly = formatTime(event.starts_at, event.timezone);
          const previewLocation = getPreviewLocation(event);
          const visibilityMeta = getVisibilityMeta(event);
          const confirmedCount = event.confirmed_count || 0;
          const thinkingCount = event.thinking_count || 0;

          return (
            <Link
              key={event.id}
              to={path}
              className={`block px-5 py-4 transition-colors hover:bg-slate-50 ${index < events.length - 1 ? 'border-b border-slate-100' : ''}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="space-y-1">
                    <h3 className="text-[15px] font-black leading-tight text-slate-900">{event.title}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${visibilityMeta.className}`}>
                        {visibilityMeta.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {previewLocation ? (
                      <span className="flex min-w-0 items-center gap-1 truncate">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                        <span className="truncate">{previewLocation}</span>
                      </span>
                    ) : null}
                    <span className="flex shrink-0 items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-brand-600" />
                      {confirmedCount}/{event.capacity} going
                    </span>
                    <span className="shrink-0">{thinkingCount} thinking about it</span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-slate-700">{dayOnly}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{timeOnly}</p>
                </div>
              </div>
            </Link>
          );
        })()
      ))}
    </div>
  );
}

function ActivitySection({
  cta,
  description,
  emptyLabel,
  events,
  pathForEvent,
  title,
}: {
  cta?: { label: string; to: string };
  description: string;
  emptyLabel: string;
  events: Event[];
  pathForEvent?: (event: Event) => string;
  title: string;
}) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-4">
        <div className="space-y-1">
          <p className="ui-eyebrow">{title}</p>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        {cta ? (
          <Link to={cta.to} className="text-sm font-bold text-brand-700">
            {cta.label}
          </Link>
        ) : null}
      </div>

      <div className="border-t border-slate-100">
        <ActivityEventList events={events} emptyLabel={emptyLabel} pathForEvent={pathForEvent} />
      </div>
    </Card>
  );
}

function CollapsibleActivitySection({
  cta,
  description,
  emptyLabel,
  events,
  expanded,
  onToggle,
  pathForEvent,
  title,
}: {
  cta?: { label: string; to: string };
  description: string;
  emptyLabel: string;
  events: Event[];
  expanded: boolean;
  onToggle: () => void;
  pathForEvent?: (event: Event) => string;
  title: string;
}) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-4">
        <div className="space-y-1">
          <p className="ui-eyebrow">{title}</p>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {cta ? (
            <Link to={cta.to} className="text-sm font-bold text-brand-700">
              {cta.label}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-slate-100">
          <ActivityEventList events={events} emptyLabel={emptyLabel} pathForEvent={pathForEvent} />
        </div>
      ) : null}
    </Card>
  );
}

function PendingRequestAccordion({
  icon,
  title,
  emptyLabel,
  rows,
  expanded,
  onToggle,
}: {
  icon: ReactNode;
  title: string;
  emptyLabel: string;
  rows: Array<PendingAccessRequestRow | PendingJoinRequestRow>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pendingLabel = `${rows.length} pending`;

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-slate-400">{icon}</span>
          <span className="truncate text-[13px] font-bold uppercase tracking-[0.14em] text-slate-400">{title}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-500">{pendingLabel}</span>
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
        </span>
      </button>
      {expanded ? rows.length === 0 ? (
        <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-400">{emptyLabel}</div>
      ) : (
        <div className="space-y-2 border-t border-slate-100 p-3">
          {rows.slice(0, 4).map((row) => {
            const eventRef = normalizeEventRef((row as PendingAccessRequestRow | PendingJoinRequestRow).events);
            const person = 'requester_name' in row ? row.requester_name : row.guest_name;
            return (
              <Link
                key={row.id}
                to={eventRef ? `/host/events/${eventRef.id}` : '/my-activities'}
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition-colors hover:bg-white"
              >
                <p className="truncate text-sm font-bold text-slate-900">{eventRef?.title || 'Activity'}</p>
                <p className="truncate text-xs text-slate-500">{person || 'Guest'} · {formatDate(row.created_at)}</p>
              </Link>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

export default function MyActivities({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'hosting' | 'attending'>('hosting');
  const [showPastHosting, setShowPastHosting] = useState(false);
  const [showPastAttending, setShowPastAttending] = useState(false);
  const [showPendingViewRequests, setShowPendingViewRequests] = useState(false);
  const [showPendingJoinRequests, setShowPendingJoinRequests] = useState(false);
  const [showAttendingEvents, setShowAttendingEvents] = useState<boolean | null>(null);
  const [showRequestedEvents, setShowRequestedEvents] = useState<boolean | null>(null);
  const [showSharedEvents, setShowSharedEvents] = useState<boolean | null>(null);
  const [hosting, setHosting] = useState<Event[]>([]);
  const [attending, setAttending] = useState<Event[]>([]);
  const [requested, setRequested] = useState<Event[]>([]);
  const [shared, setShared] = useState<Event[]>([]);
  const [pendingViewRequests, setPendingViewRequests] = useState<PendingAccessRequestRow[]>([]);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [hostedResult, joinedResult, sharedResult] = await Promise.all([
          supabase.rpc('list_my_hosted_events'),
          supabase.rpc('list_my_joined_activities'),
          supabase.rpc('list_my_shared_activities'),
        ]);

        if (cancelled) return;

        const hosted = (hostedResult.data || []) as Event[];
        const joinedRows = (joinedResult.data || []) as JoinedRow[];
        const sharedRows = (sharedResult.data || []) as Event[];

        const hostedWithCounts = withConfirmedCounts(
          await Promise.all(
            hosted.map(async (event) => {
              const [attendeesResult, interestsResult] = await Promise.all([
                supabase.rpc('host_list_attendees_for_dashboard', {
                  p_event_id: event.id,
                }),
                supabase.rpc('host_list_interests_for_dashboard', {
                  p_event_id: event.id,
                }),
              ]);

              if (attendeesResult.error) {
                console.warn(`Could not load hosted attendee count for event ${event.id}:`, attendeesResult.error);
              }
              if (interestsResult.error) {
                console.warn(`Could not load hosted interest count for event ${event.id}:`, interestsResult.error);
              }

              return {
                ...event,
                event_attendees: ((attendeesResult.data || []) as HostedAttendeeCountRow[]).map((row) => ({
                  status: row.status,
                })),
                event_interests: ((interestsResult.data || []) as HostedInterestCountRow[]).map((row) => ({
                  id: row.id,
                })),
              };
            }),
          ),
        );

        const requestedRows = joinedRows.filter((row) => row.status === 'pending_approval');
        const attendingRows = joinedRows.filter((row) => row.status !== 'pending_approval');

        const hostedUpcoming = upcomingOnly(hostedWithCounts);
        const hostedUpcomingIds = hostedUpcoming.map((event) => event.id);
        const [pendingAccessResult, pendingJoinResult] = await Promise.all([
          hostedUpcomingIds.length
            ? supabase
                .from('event_access_requests')
                .select('id,event_id,requester_name,created_at,status,events!inner(id,title)')
                .eq('status', 'pending')
                .in('event_id', hostedUpcomingIds)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          hostedUpcomingIds.length
            ? supabase
                .from('event_join_requests')
                .select('id,event_id,guest_name,created_at,status,events!inner(id,title)')
                .eq('status', 'pending')
                .in('event_id', hostedUpcomingIds)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (pendingAccessResult.error) {
          console.warn('Could not load pending view requests:', pendingAccessResult.error);
        }
        if (pendingJoinResult.error) {
          console.warn('Could not load pending join requests:', pendingJoinResult.error);
        }

        setHosting(hostedWithCounts);
        setRequested(
          groupBookingsByEvent(requestedRows as BookingRow[]).map((row) => row.events as Event),
        );
        setAttending(
          groupBookingsByEvent(attendingRows as BookingRow[]).map((row) => row.events as Event),
        );
        setShared(sharedRows);
        setPendingViewRequests((pendingAccessResult.data || []) as PendingAccessRequestRow[]);
        setPendingJoinRequests((pendingJoinResult.data || []) as PendingJoinRequestRow[]);
      } catch (error) {
        console.error('Could not load activity state:', error);
        setHosting([]);
        setRequested([]);
        setAttending([]);
        setShared([]);
        setPendingViewRequests([]);
        setPendingJoinRequests([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const upcomingHosting = useMemo(() => upcomingOnly(hosting), [hosting]);
  const pastHosting = useMemo(() => pastOnly(hosting), [hosting]);
  const upcomingAttending = useMemo(() => upcomingOnly(attending), [attending]);
  const pastAttending = useMemo(() => pastOnly(attending), [attending]);
  const upcomingRequested = useMemo(() => upcomingOnly(requested), [requested]);
  const pastRequested = useMemo(() => pastOnly(requested), [requested]);
  const upcomingShared = useMemo(() => upcomingOnly(shared), [shared]);
  const pastShared = useMemo(() => pastOnly(shared), [shared]);
  const attendingExpanded = showAttendingEvents ?? (upcomingAttending.length > 0);
  const requestedExpanded = showRequestedEvents ?? (upcomingRequested.length > 0);
  const sharedExpanded = showSharedEvents ?? (upcomingShared.length > 0);
  const pastCombinedAttending = useMemo(() => {
    const deduped = new Map<string, Event>();
    [...pastAttending, ...pastRequested, ...pastShared].forEach((event) => {
      if (!deduped.has(event.id)) deduped.set(event.id, event);
    });
    return Array.from(deduped.values());
  }, [pastAttending, pastRequested, pastShared]);

  const pastAttendingCount = pastAttending.length + pastRequested.length + pastShared.length;
  const showAuthPrompt = !user && searchParams.get('signin') === 'true';

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50">
        <main className="mx-auto max-w-2xl px-6 pb-10 pt-2">
          <div className="space-y-6">
            <Card className="space-y-3">
              <p className="text-sm text-slate-500">Guests can browse, but activities you host, attend, request, or open by link appear here after you sign in.</p>
            </Card>
            <ActivitySection
              title="Hosting"
              description="Activities you are running."
              emptyLabel="No hosted activities yet."
              events={[]}
            />
            <ActivitySection
              title="Attending"
              description="Activities you have already joined."
              emptyLabel="No attending activities yet."
              events={[]}
            />
            <ActivitySection
              title="Requested"
              description="Requests waiting on host approval."
              emptyLabel="No pending requests right now."
              events={[]}
            />
            <ActivitySection
              title="Shared with you"
              description="Activities opened by link or join code."
              emptyLabel="No shared activities yet."
              events={[]}
            />
          </div>
        </main>
        <AuthPromptModal
          open={showAuthPrompt}
          onClose={() => navigate('/my-activities', { replace: true })}
          title="Sign in to see your activities"
          message="Track what you’re hosting, attending, requesting, or what has been shared with you."
          postAuthRedirect="/my-activities"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-2xl px-6 pb-10 pt-2">
        <div className="space-y-6">
          <div className="grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab('hosting')}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                activeTab === 'hosting' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Hosting
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('attending')}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                activeTab === 'attending' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Attending
            </button>
          </div>

          {loading ? (
            <Card className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </Card>
          ) : (
            <>
              {activeTab === 'hosting' ? (
                <>
                  <div className="space-y-1.5">
                    <PendingRequestAccordion
                      icon={<Eye className="h-4 w-4" />}
                      title="Requested to view"
                      emptyLabel="No pending requests right now."
                      rows={pendingViewRequests}
                      expanded={showPendingViewRequests}
                      onToggle={() => setShowPendingViewRequests((value) => !value)}
                    />
                    <PendingRequestAccordion
                      icon={<UserRound className="h-4 w-4" />}
                      title="Requested to join"
                      emptyLabel="No pending join requests right now."
                      rows={pendingJoinRequests}
                      expanded={showPendingJoinRequests}
                      onToggle={() => setShowPendingJoinRequests((value) => !value)}
                    />
                    <ActivitySection
                      title="Hosting"
                      description="Activities you are running."
                      emptyLabel="You are not hosting anything yet."
                      events={upcomingHosting}
                      pathForEvent={(event) => `/host/events/${event.id}`}
                      cta={{ label: 'Create', to: '/create-event' }}
                    />
                  </div>
                  {pastHosting.length > 0 ? (
                    <Card className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowPastHosting((value) => !value)}
                        className="flex w-full items-center justify-between text-left text-sm font-bold text-slate-600"
                      >
                        <span>Past activities ({pastHosting.length})</span>
                        {showPastHosting ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showPastHosting ? (
                        <div className="space-y-3 border-t border-slate-100 pt-3">
                          <p className="text-sm text-slate-500">Previous activities you hosted.</p>
                          <ActivityEventList
                          emptyLabel="No past hosted activities."
                          events={pastHosting}
                          pathForEvent={(event) => `/host/events/${event.id}`}
                        />
                        </div>
                      ) : null}
                    </Card>
                  ) : null}
                </>
              ) : (
                <>
                  <CollapsibleActivitySection
                    title="Attending"
                    description="Activities you have already joined."
                    emptyLabel="You are not attending anything yet."
                    events={upcomingAttending}
                    cta={{ label: 'Explore', to: '/explore' }}
                    expanded={attendingExpanded}
                    onToggle={() =>
                      setShowAttendingEvents((value) => !(value ?? (upcomingAttending.length > 0)))
                    }
                  />
                  <CollapsibleActivitySection
                    title="Requested"
                    description="Activities you requested to join and are waiting on host approval."
                    emptyLabel="No pending requests right now."
                    events={upcomingRequested}
                    expanded={requestedExpanded}
                    onToggle={() =>
                      setShowRequestedEvents((value) => !(value ?? (upcomingRequested.length > 0)))
                    }
                  />
                  <CollapsibleActivitySection
                    title="Shared with me"
                    description="Activities opened by link or join code."
                    emptyLabel="Nothing has been shared with you yet."
                    events={upcomingShared}
                    expanded={sharedExpanded}
                    onToggle={() =>
                      setShowSharedEvents((value) => !(value ?? (upcomingShared.length > 0)))
                    }
                  />
                  {pastAttendingCount > 0 ? (
                    <Card className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowPastAttending((value) => !value)}
                        className="flex w-full items-center justify-between text-left text-sm font-bold text-slate-600"
                      >
                        <span>Past activities ({pastAttendingCount})</span>
                        {showPastAttending ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showPastAttending ? (
                        <div className="space-y-3 border-t border-slate-100 pt-3">
                          <p className="text-sm text-slate-500">
                            Older attending, requested, and shared activities.
                          </p>
                          <ActivityEventList
                            emptyLabel="No past activities."
                            events={pastCombinedAttending}
                          />
                        </div>
                      ) : null}
                    </Card>
                  ) : null}
                </>
              )}

            </>
          )}
        </div>
      </main>
    </div>
  );
}
