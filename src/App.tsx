/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';

// Pages
import Home from './pages/Home';
import Login from './pages/Login';
import CreateEvent from './pages/CreateEvent';
import EventDetail from './pages/EventDetail';
import HostDashboard from './pages/HostDashboard';
import Calendar from './pages/Calendar';
import Recovery from './pages/Recovery';
import Bookings from './pages/Bookings';
import MyActivities from './pages/MyActivities';
import AdminHome from './pages/AdminHome';
import AdminModeration from './pages/AdminModeration';
import AdminFeedback from './pages/AdminFeedback';
import ModerationTransparency from './pages/ModerationTransparency';
import { guestService } from './services/guestService';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    try {
      // Check active sessions and sets the user
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }).catch(err => {
        if (err.message.includes('Supabase configuration missing')) {
          setConfigError(err.message);
          setLoading(false);
        }
      });

      // Listen for changes on auth state (logged in, signed out, etc.)
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });

      return () => subscription.unsubscribe();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Supabase configuration missing')) {
        setConfigError(err.message);
        setLoading(false);
      } else {
        console.error('Unexpected error during initialization:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      guestService.getOrCreateProfileForUser(user).catch(err => {
        console.error('Error syncing profile:', err);
      });
    }
  }, [user]);

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
        <div className="max-w-md bg-white p-10 rounded-4xl shadow-2xl shadow-slate-200/50 border border-slate-50">
          <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">Setup Required</h1>
          <p className="text-slate-500 mb-8 leading-relaxed font-medium">
            <span className="italic">I&apos;m In</span> needs Supabase to store your activities. Please add your Supabase URL and Anon Key to the environment variables.
          </p>
          <div className="bg-slate-50 p-6 rounded-2xl text-left text-xs font-mono text-slate-400 break-all mb-10 border border-slate-100">
            {configError}
          </div>
          <a 
            href="https://supabase.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-block bg-slate-900 text-white px-8 py-4 rounded-2xl font-black hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-900/20"
          >
            Go to Supabase
          </a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-brand-100">
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/login" element={<Login user={user} />} />
          <Route path="/create-event" element={<CreateEvent user={user} />} />
          <Route path="/host/events/:id/edit" element={user ? <CreateEvent user={user} /> : <Navigate to="/login" />} />
          <Route path="/events/:slug" element={<EventDetail user={user} />} />
          <Route path="/host/events/:id" element={user ? <HostDashboard user={user} /> : <Navigate to="/login" />} />
          <Route path="/calendar" element={<Calendar user={user} />} />
          <Route path="/my-activities" element={user ? <MyActivities user={user} /> : <Navigate to="/login" />} />
          <Route path="/moderation" element={<ModerationTransparency />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/recover" element={<Recovery />} />
          <Route path="/admin" element={user ? <AdminHome user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/moderation" element={user ? <AdminModeration user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/feedback" element={user ? <AdminFeedback user={user} /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </Router>
  );
}

