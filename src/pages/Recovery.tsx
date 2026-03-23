import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { guestService } from '../services/guestService';
import { CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[2.5rem] p-10 shadow-2xl border border-slate-100 text-center"
      >
        {status === 'loading' && (
          <div className="space-y-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto"></div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Restoring your session...</h1>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-brand-50 rounded-3xl flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-brand-600" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Session Restored!</h1>
              <p className="text-slate-500 font-medium">{message}</p>
            </div>
            <button 
              onClick={() => navigate('/bookings')}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              View My Bookings
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Recovery Failed</h1>
              <p className="text-slate-500 font-medium">{message}</p>
            </div>
            <button 
              onClick={() => navigate('/login')}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-4 rounded-2xl transition-all active:scale-95"
            >
              Back to Login
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
