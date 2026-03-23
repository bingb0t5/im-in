import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, ArrowRight, CheckCircle2, ArrowLeft, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { guestService } from '../services/guestService';

export default function Login({ user }: { user: User | null }) {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(searchParams.get('recovery') === 'true');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySent, setRecoverySent] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (searchParams.get('recovery') === 'true') {
      setShowRecovery(true);
    }
  }, [searchParams]);

  if (user) {
    navigate('/create-event');
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await guestService.sendRecoveryEmail(recoveryEmail);
      setRecoverySent(true);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10 w-full">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-black text-slate-900 tracking-tight">Sign In</h1>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Manage your events</span>
          </div>
          <div className="w-10" />
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl shadow-sm p-8 border border-slate-100"
      >
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-50 rounded-2xl mb-4">
            {showRecovery ? <Search className="w-8 h-8 text-brand-600" /> : <Mail className="w-8 h-8 text-brand-600" />}
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            {showRecovery ? 'Find my bookings' : 'Welcome Back'}
          </h1>
          <p className="text-slate-500 mt-2 font-medium text-sm">
            {showRecovery ? 'Enter your email to get a recovery link.' : 'Sign in to manage your events.'}
          </p>
        </div>

        {showRecovery ? (
          <div className="space-y-6">
            {recoverySent ? (
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <CheckCircle2 className="w-12 h-12 text-brand-600" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Link Sent</h2>
                <p className="text-slate-600 text-sm font-medium">
                  If an account exists for <span className="font-black text-slate-900">{recoveryEmail}</span>, we've sent a recovery link.
                </p>
                <button 
                  onClick={() => setShowRecovery(false)}
                  className="text-brand-600 font-black text-sm hover:underline"
                >
                  Back to Login
                </button>
              </div>
            ) : (
              <form onSubmit={handleRecovery} className="space-y-6">
                <div>
                  <label htmlFor="recovery-email" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                    Email Address
                  </label>
                  <input
                    id="recovery-email"
                    type="email"
                    required
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all font-bold text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-xl shadow-lg shadow-brand-600/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                >
                  {loading ? 'Sending...' : 'Send Recovery Link'}
                </button>
                <button 
                  type="button"
                  onClick={() => setShowRecovery(false)}
                  className="w-full text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-slate-600 transition-colors"
                >
                  Back to Login
                </button>
              </form>
            )}
          </div>
        ) : sent ? (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle2 className="w-12 h-12 text-brand-600" />
            </div>
            <h2 className="text-lg font-black text-slate-900">Check your email</h2>
            <p className="text-slate-600 text-sm font-medium">
              We've sent a magic link to <span className="font-black text-slate-900">{email}</span>. 
              Click the link to sign in instantly.
            </p>
            <button 
              onClick={() => setSent(false)}
              className="text-brand-600 font-black text-sm hover:underline"
            >
              Try another email
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full bg-white hover:bg-slate-50 text-slate-700 font-black py-3.5 rounded-xl border border-slate-200 shadow-sm transition-all flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95 text-sm"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-100"></div>
              </div>
              <div className="relative flex justify-center text-[10px] uppercase">
                <span className="bg-white px-3 text-slate-400 font-black tracking-widest">Or with email</span>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 outline-none transition-all font-bold text-sm"
                />
              </div>

              {error && (
                <p className="text-red-500 text-xs font-bold bg-red-50 p-3 rounded-xl border border-red-100">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-xl shadow-lg shadow-brand-600/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
              >
                {loading ? 'Sending...' : 'Send Magic Link'}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </button>
            </form>
          </div>
        )}
      </motion.div>
      
      <div className="mt-8 flex flex-col items-center gap-4">
        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
          No account? One will be created for you.
        </p>
        {!showRecovery && (
          <button 
            onClick={() => setShowRecovery(true)}
            className="text-brand-600 font-black text-xs uppercase tracking-widest hover:bg-brand-50 px-4 py-2 rounded-lg transition-all"
          >
            Lost your guest bookings?
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
