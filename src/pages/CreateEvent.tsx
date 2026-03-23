import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, MapPin, Users, ArrowLeft, Save, AlertCircle, Info } from 'lucide-react';
import { motion } from 'motion/react';
import { generateSlug } from '../utils';
import { pickWaitlistAttendeesForPromotion } from '../lib/rsvp';

export default function CreateEvent({ user }: { user: User | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEditing);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location_text: '',
    starts_at: '',
    ends_at: '',
    capacity: 10,
    host_name: '',
    host_contact_text: '',
    allow_waitlist: true,
    is_public: true,
  });

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing && user) {
      fetchEvent();
    }
  }, [id, user]);

  const fetchEvent = async () => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error || data.host_user_id !== user?.id) {
      console.error(error);
      navigate('/');
    } else {
      // Format dates for datetime-local input
      const formatForInput = (dateStr: string | null) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toISOString().slice(0, 16);
      };

      setFormData({
        title: data.title || '',
        description: data.description || '',
        location_text: data.location_text || '',
        starts_at: formatForInput(data.starts_at),
        ends_at: formatForInput(data.ends_at),
        capacity: data.capacity ?? 10,
        host_name: data.host_name || '',
        host_contact_text: data.host_contact_text || '',
        allow_waitlist: data.allow_waitlist ?? true,
        is_public: data.is_public ?? true,
      });
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch old capacity for comparison
      let oldCapacity = 0;
      if (isEditing) {
        const { data: oldEvent } = await supabase
          .from('events')
          .select('capacity')
          .eq('id', id)
          .single();
        oldCapacity = oldEvent?.capacity || 0;
      }

      // Clean up optional fields: convert empty strings to null
      const submissionData: any = {
        ...formData,
        host_user_id: user.id,
        description: formData.description.trim() || null,
        location_text: formData.location_text.trim() || null,
        ends_at: formData.ends_at || null,
        host_contact_text: formData.host_contact_text.trim() || null,
      };

      if (!isEditing) {
        submissionData.slug = `${generateSlug(formData.title)}-${Math.random().toString(36).substring(2, 7)}`;
        submissionData.status = 'scheduled';
      }

      let result;
      if (isEditing) {
        result = await supabase
          .from('events')
          .update(submissionData)
          .eq('id', id)
          .select()
          .single();
      } else {
        result = await supabase
          .from('events')
          .insert([submissionData])
          .select()
          .single();
      }

      if (result.error) {
        throw result.error;
      }

      if (result.data) {
        // If capacity increased, promote people from waitlist
        if (isEditing && formData.capacity > oldCapacity) {
          const { data: waitlist } = await supabase
            .from('event_attendees')
            .select('*')
            .eq('event_id', id)
            .eq('status', 'waitlist')
            .order('joined_at', { ascending: true });

          if (waitlist && waitlist.length > 0) {
            const { data: confirmed } = await supabase
              .from('event_attendees')
              .select('id')
              .eq('event_id', id)
              .eq('status', 'confirmed');
            
            const currentConfirmedCount = confirmed?.length || 0;
            const spotsAvailable = formData.capacity - currentConfirmedCount;

            if (spotsAvailable > 0) {
              const toPromote = pickWaitlistAttendeesForPromotion(waitlist, spotsAvailable);
              for (const person of toPromote) {
                await supabase
                  .from('event_attendees')
                  .update({ status: 'confirmed', promoted_at: new Date().toISOString() })
                  .eq('id', person.id);
              }
            }
          }
        }
        navigate(`/host/events/${result.data.id}`);
      }
    } catch (err: any) {
      console.error('Error saving event:', err);
      setError(err.message || 'Failed to save event. Please try again.');
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate(isEditing ? `/host/events/${id}` : '/')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-lg font-black text-slate-900 tracking-tight">{isEditing ? 'Edit Event' : 'New Event'}</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-8">
        <motion.form 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit} 
          className="space-y-8"
        >
          {/* Basic Info */}
          <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Event Title</label>
              <input
                required
                type="text"
                placeholder="e.g. Sunday Morning Yoga"
                className="w-full text-2xl font-black bg-transparent border-b-2 border-slate-50 focus:border-brand-600 outline-none pb-3 transition-all placeholder:text-slate-200"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Description (Optional)</label>
              <textarea
                rows={4}
                placeholder="What should people know?"
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all font-medium text-sm"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </section>

          {/* Logistics */}
          <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                  <Calendar className="w-3.5 h-3.5 text-brand-600" /> Starts At
                </label>
                <input
                  required
                  type="datetime-local"
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.starts_at}
                  onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-300" /> Ends At (Optional)
                </label>
                <input
                  type="datetime-local"
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.ends_at}
                  onChange={(e) => setFormData({ ...formData, ends_at: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                <MapPin className="w-3.5 h-3.5 text-brand-600" /> Location
              </label>
              <input
                type="text"
                placeholder="Where is it happening?"
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                value={formData.location_text}
                onChange={(e) => setFormData({ ...formData, location_text: e.target.value })}
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                <Users className="w-3.5 h-3.5 text-brand-600" /> Capacity
              </label>
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <input
                  required
                  type="number"
                  min="1"
                  className="w-full sm:w-28 p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-center text-sm"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                />
                <label className="flex items-center gap-2.5 text-slate-600 font-bold cursor-pointer select-none text-sm">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      className="peer w-5 h-5 rounded border-slate-200 text-brand-600 focus:ring-brand-600 transition-all"
                      checked={formData.allow_waitlist}
                      onChange={(e) => setFormData({ ...formData, allow_waitlist: e.target.checked })}
                    />
                  </div>
                  <span>Allow Waitlist</span>
                  <Info className="w-3.5 h-3.5 text-slate-300" />
                </label>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-50">
              <label className="flex items-center gap-4 text-slate-900 font-black cursor-pointer select-none group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    className="peer w-7 h-7 rounded-xl border-2 border-slate-200 text-brand-600 focus:ring-brand-600 transition-all"
                    checked={formData.is_public}
                    onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-base tracking-tight">List on public calendar</span>
                  <span className="text-xs text-slate-400 font-medium">Anyone can see and join this event from the main events page.</span>
                </div>
              </label>
            </div>
          </section>

          {/* Host Info */}
          <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Host Name</label>
                <input
                  required
                  type="text"
                  placeholder="Your Name"
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.host_name}
                  onChange={(e) => setFormData({ ...formData, host_name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Contact Info (Optional)</label>
                <input
                  type="text"
                  placeholder="WhatsApp / Phone"
                  className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-bold text-sm"
                  value={formData.host_contact_text}
                  onChange={(e) => setFormData({ ...formData, host_contact_text: e.target.value })}
                />
              </div>
            </div>
          </section>

          {error && (
            <div className="p-5 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="font-bold text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-brand-600/10 mt-2 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
          >
            {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
            {!loading && <Save className="w-5 h-5" />}
          </button>
        </motion.form>
      </main>

      <footer className="max-w-2xl mx-auto px-6 mt-12 pb-10 text-center">
        <p className="text-slate-300 text-[9px] font-bold uppercase tracking-[0.2em]">
          Powered by Lalo
        </p>
      </footer>
    </div>
  );
}
