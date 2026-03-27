import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guestService } from '../services/guestService';
import { ArrowLeft, Calendar, MapPin, AlertCircle, LogOut } from 'lucide-react';
import { formatDate, isOnOrAfterTodayInTimeZone } from '../utils';
import { motion } from 'motion/react';
import { BookingRow, GroupedBooking, groupBookingsByEvent } from '../lib/bookings';
import { AttendeeProfile } from '../services/guestService';
import { buildEventPath } from '../lib/events';
import { goBackOr } from '../lib/navigation';

export default function Bookings() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [showPastActivities, setShowPastActivities] = useState(false);

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const session = await guestService.getStoredGuestSession();
        if (!session) {
          navigate('/');
          return;
        }
        setProfile(session.profile);
        const [bookingRows, interestRows] = await Promise.all([
          guestService.getMyBookings(session.token),
          guestService.getMyInterests(session.token),
        ]);
        setBookings([...(bookingRows || []), ...(interestRows || [])]);
      } catch (error) {
        console.error('Fetch Bookings Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, [navigate]);

  const handleLogout = () => {
    guestService.clearStoredSession();
    navigate('/');
  };

  const groupedBookings = groupBookingsByEvent(bookings);
  const upcomingBookings = groupedBookings.filter((groupedBooking) =>
    isOnOrAfterTodayInTimeZone(groupedBooking.events.starts_at, groupedBooking.events.timezone),
  );
  const pastBookings = groupedBookings.filter((groupedBooking) =>
    !isOnOrAfterTodayInTimeZone(groupedBooking.events.starts_at, groupedBooking.events.timezone),
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
          <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="w-9 h-9 bg-slate-100 rounded-xl animate-pulse" />
            <div className="w-28 h-4 bg-slate-100 rounded-full animate-pulse" />
            <div className="w-9 h-9 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        </div>
        <main className="max-w-xl mx-auto px-6 pt-8">
          <div className="bg-white rounded-2xl overflow-hidden">
            {[1,2,3].map(i => (
              <div key={i} className="px-5 py-4 border-b border-slate-50 last:border-0 space-y-2 animate-pulse">
                <div className="h-4 bg-slate-100 rounded-full w-1/2" />
                <div className="h-3 bg-slate-100 rounded-full w-1/3" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => goBackOr(navigate, '/')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Activities I'm In</span>
          <button onClick={handleLogout} className="p-2 hover:bg-red-50 rounded-xl transition-all group" title="Sign out of this device">
            <LogOut className="w-5 h-5 text-slate-400 group-hover:text-red-500" />
          </button>
        </div>
      </div>

      <main className="max-w-xl mx-auto px-6 pt-8 space-y-8">
        <header>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Your Activities</h1>
          <p className="text-slate-500 font-medium text-sm mt-1">
            Logged in as <span className="text-slate-900 font-bold">{profile?.full_name}</span>
          </p>
        </header>

        {groupedBookings.length === 0 ? (
          <div className="text-center py-20">
            <AlertCircle className="w-8 h-8 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 text-sm mb-6">No activities found.</p>
            <button 
              onClick={() => navigate('/calendar')}
              className="text-brand-600 font-bold text-sm hover:text-brand-500 transition-all"
            >
              Browse what's on →
            </button>
          </div>
        ) : upcomingBookings.length === 0 ? (
          <div className="text-center py-20">
            <AlertCircle className="w-8 h-8 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 text-sm">No upcoming activities right now.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl overflow-hidden">
            {upcomingBookings.map((groupedBooking: GroupedBooking, idx: number) => (
              <motion.div
                key={groupedBooking.events.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => navigate(buildEventPath(groupedBooking.events as any, { preferPrivateAccess: true }))}
                className={`px-5 py-4 hover:bg-slate-50 transition-all cursor-pointer active:scale-[0.99] ${groupedBooking.status === 'thinking' ? 'bg-indigo-50/60' : ''} ${idx < upcomingBookings.length - 1 ? 'border-b border-slate-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 leading-tight">{groupedBooking.events.title}</h3>
                    {groupedBooking.status === 'thinking' && (
                      <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5">I'm thinking about it</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {groupedBooking.attendees.map((name: string, i: number) => (
                        <span key={i} className="text-[10px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md">
                          {name}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{formatDate(groupedBooking.events.starts_at, groupedBooking.events.timezone)}</p>
                    {groupedBooking.events.location_text && (
                      <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3" />{groupedBooking.events.location_text}
                      </p>
                    )}
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-widest shrink-0 ${
                    groupedBooking.status === 'confirmed'
                      ? 'text-brand-600'
                      : groupedBooking.status === 'thinking'
                        ? 'text-indigo-500'
                        : 'text-amber-500'
                  }`}>
                    {groupedBooking.status}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {!loading && pastBookings.length > 0 ? (
          <section className="pt-1">
            <button
              type="button"
              onClick={() => setShowPastActivities((prev) => !prev)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
            >
              {showPastActivities ? 'Hide past activities' : `Past activities (${pastBookings.length})`}
            </button>
            {showPastActivities ? (
              <div className="mt-3 bg-white rounded-2xl overflow-hidden">
                {pastBookings.map((groupedBooking: GroupedBooking, idx: number) => (
                  <motion.div
                    key={groupedBooking.events.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => navigate(buildEventPath(groupedBooking.events as any, { preferPrivateAccess: true }))}
                    className={`px-5 py-4 hover:bg-slate-50 transition-all cursor-pointer active:scale-[0.99] ${groupedBooking.status === 'thinking' ? 'bg-indigo-50/60' : ''} ${idx < pastBookings.length - 1 ? 'border-b border-slate-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 leading-tight">{groupedBooking.events.title}</h3>
                        {groupedBooking.status === 'thinking' && (
                          <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5">I'm thinking about it</p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {groupedBooking.attendees.map((name: string, i: number) => (
                            <span key={i} className="text-[10px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md">
                              {name}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{formatDate(groupedBooking.events.starts_at, groupedBooking.events.timezone)}</p>
                        {groupedBooking.events.location_text && (
                          <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />{groupedBooking.events.location_text}
                          </p>
                        )}
                      </div>
                      <span className={`text-[9px] font-bold uppercase tracking-widest shrink-0 ${
                        groupedBooking.status === 'confirmed'
                          ? 'text-brand-600'
                          : groupedBooking.status === 'thinking'
                            ? 'text-indigo-500'
                            : 'text-amber-500'
                      }`}>
                        {groupedBooking.status}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
