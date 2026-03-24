import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guestService } from '../services/guestService';
import { ArrowLeft, Calendar, MapPin, AlertCircle, LogOut } from 'lucide-react';
import { formatDate } from '../utils';
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

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const session = await guestService.getStoredGuestSession();
        if (!session) {
          navigate('/');
          return;
        }
        setProfile(session.profile);
        const data = await guestService.getMyBookings(session.token);
        setBookings(data);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
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

        <div className="space-y-4">
          {bookings.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
              <AlertCircle className="w-12 h-12 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-500 font-bold">No activities found.</p>
              <button 
                onClick={() => navigate('/')}
                className="mt-6 text-brand-600 font-black text-sm uppercase tracking-widest hover:bg-brand-50 px-6 py-3 rounded-xl transition-all"
              >
                What's On
              </button>
            </div>
          ) : (
            groupedBookings.map((groupedBooking: GroupedBooking) => (
              <motion.div
                key={groupedBooking.events.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => navigate(buildEventPath(groupedBooking.events as any, { preferPrivateAccess: true }))}
                className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 hover:border-brand-600/20 hover:shadow-md transition-all cursor-pointer group"
              >
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-1">
                      <h3 className="text-xl font-black text-slate-900 group-hover:text-brand-600 transition-colors">
                        {groupedBooking.events.title}
                      </h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {groupedBooking.attendees.map((name: string, i: number) => (
                          <span key={i} className="text-[10px] font-bold text-brand-600 uppercase tracking-widest bg-brand-50 px-2 py-0.5 rounded-md">
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${
                      groupedBooking.status === 'confirmed' 
                        ? 'bg-brand-50 text-brand-600 border-brand-100' 
                        : 'bg-amber-50 text-amber-600 border-amber-100'
                    }`}>
                      {groupedBooking.status}
                    </span>
                  </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm font-bold">{formatDate(groupedBooking.events.starts_at, groupedBooking.events.timezone)}</span>
                  </div>
                  {groupedBooking.events.location_text && (
                    <div className="flex items-center gap-2 text-slate-400">
                      <MapPin className="w-4 h-4" />
                      <span className="text-sm font-medium">{groupedBooking.events.location_text}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
