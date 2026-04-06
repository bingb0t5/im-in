import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { guestService } from '../services/guestService';
import { CheckCircle2, AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

export default function Recovery() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No recovery token found in the URL.');
      return;
    }

    const recover = async () => {
      try {
        const profile = await guestService.validateSession(token);
        if (profile) {
          guestService.setStoredSession(token);
          setStatus('success');
          setMessage(`Welcome back, ${profile.first_name}! We've restored your guest session.`);
        } else {
          setStatus('error');
          setMessage('This recovery link is invalid or has expired.');
        }
      } catch (error) {
        console.error('Recovery error:', error);
        setStatus('error');
        setMessage('Something went wrong while restoring your session.');
      }
    };

    recover();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-lg items-center justify-between px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-xl p-2 transition-all hover:bg-slate-50"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </button>
          <h1 className="text-lg font-black tracking-tight text-slate-900">Sign In</h1>
          <div className="w-10" />
        </div>
      </header>

      <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-[2.5rem] border border-slate-100 bg-white p-10 text-center shadow-2xl"
        >
          {status === 'loading' && (
            <div className="space-y-6">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-brand-600"></div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">Restoring your session...</h1>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-6">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-50">
                <CheckCircle2 className="h-10 w-10 text-brand-600" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black tracking-tight text-slate-900">Session Restored!</h1>
                <p className="font-medium text-slate-500">{message}</p>
              </div>
              <button
                onClick={() => navigate('/bookings')}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-4 font-black text-white shadow-lg shadow-brand-600/10 transition-all active:scale-95 hover:bg-brand-500"
              >
                View My Bookings
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-6">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-red-50">
                <AlertCircle className="h-10 w-10 text-red-500" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black tracking-tight text-slate-900">Recovery Failed</h1>
                <p className="font-medium text-slate-500">{message}</p>
              </div>
              <button
                onClick={() => navigate('/login')}
                className="w-full rounded-2xl bg-slate-100 py-4 font-black text-slate-600 transition-all active:scale-95 hover:bg-slate-200"
              >
                Back to Login
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
