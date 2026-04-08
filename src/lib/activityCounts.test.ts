import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '../types';
import { hydrateMissingEventCounts } from './activityCounts';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

function createCountQuery(result: { count: number | null; error: { message: string } | null }) {
  const query: any = {
    count: result.count,
    error: result.error,
  };
  query.eq = vi.fn().mockReturnValue(query);
  return query;
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    slug: 'event-1',
    title: 'Event 1',
    starts_at: new Date().toISOString(),
    capacity: 10,
    host_user_id: 'host-1',
    allow_waitlist: true,
    is_public: true,
    status: 'scheduled',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('hydrateMissingEventCounts', () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
    supabaseMock.rpc.mockReset();
  });

  it('fills missing counts from exact table counts', async () => {
    supabaseMock.from.mockImplementation((table: string) => ({
      select: vi.fn(() =>
        table === 'event_attendees'
          ? createCountQuery({ count: 3, error: null })
          : createCountQuery({ count: 2, error: null }),
      ),
    }));

    const result = await hydrateMissingEventCounts([makeEvent()]);

    expect(result[0].confirmed_count).toBe(3);
    expect(result[0].thinking_count).toBe(2);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('does nothing when counts are already present', async () => {
    const event = makeEvent({
      confirmed_count: 0,
      thinking_count: 4,
    });

    const result = await hydrateMissingEventCounts([event]);

    expect(result).toEqual([event]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('falls back to event view RPCs when direct count queries fail', async () => {
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(() => createCountQuery({ count: null, error: { message: 'permission denied' } })),
    }));
    supabaseMock.rpc.mockImplementation((fn: string) => {
      if (fn === 'list_event_attendees_for_view') {
        return Promise.resolve({
          data: [{ status: 'confirmed' }, { status: 'waitlist' }, { status: 'confirmed' }],
          error: null,
        });
      }
      if (fn === 'list_event_interests_for_view') {
        return Promise.resolve({
          data: [{ id: 'interest-1' }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const result = await hydrateMissingEventCounts([makeEvent({ is_public: false, private_slug: 'private-code' })]);

    expect(result[0].confirmed_count).toBe(2);
    expect(result[0].thinking_count).toBe(1);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
  });
});
