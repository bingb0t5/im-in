import { useCallback, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AttendeeProfile, guestService } from '../services/guestService';

export function useAttendeeProfile(user: User | null) {
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshProfile = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void guestService
      .getProfileForUser(user)
      .then((nextProfile) => {
        if (!cancelled) setProfile(nextProfile);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, refreshKey]);

  return {
    profile,
    loading,
    refreshProfile,
  };
}
