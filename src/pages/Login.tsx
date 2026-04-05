import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { User } from '@supabase/supabase-js';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { buildAuthRedirectUrl } from '../lib/authRedirect';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { clearAllLaloAuthState, isLaloWhatsAppAuthEnabled } from '../integrations/lalo/laloAuth';

export default function Login({ user }: { user: User | null }) {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(searchParams.get('recovery') === 'true');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySent, setRecoverySent] = useState(false);
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const navigate = useNavigate();
  const laloEnabled = isLaloWhatsAppAuthEnabled();

  useEffect(() => {
    if (searchParams.get('recovery') === 'true') {
      setShowRecovery(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (showRecovery) {
      setShowEmailLogin(false);
    }
  }, [showRecovery]);

  useEffect(() => {
    if (!laloEnabled) {
      setShowEmailLogin(true);
      clearAllLaloAuthState();
    }
  }, [laloEnabled]);

  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: buildAuthRedirectUrl('/'),
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const normalizedEmail = recoveryEmail.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: buildAuthRedirectUrl('/'),
        },
      });
      if (error) throw error;
      setRecoverySent(true);
      setRecoveryEmail(normalizedEmail);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to send recovery link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="ui-page-shell flex min-h-[calc(100svh-8rem)] flex-col justify-center py-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="space-y-6">
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <img
                  src="/im-in-svg-logo-size.svg"
                  alt="I'm In"
                  className="h-12 w-auto"
                />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black tracking-tight text-slate-900">
                  {showRecovery ? 'Find my bookings' : 'Choose how to continue'}
                </h2>
                <p className="text-sm font-medium leading-relaxed text-slate-500">
                  {showRecovery
                    ? 'Enter your email to get a recovery link.'
                    : 'Use the main sign-in option below, or choose another method if needed.'}
                </p>
              </div>
            </div>

            {showRecovery ? (
              recoverySent ? (
                <div className="space-y-5 text-center">
                  <div className="flex justify-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                      <CheckCircle2 className="h-7 w-7" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-black text-slate-900">Link sent</h3>
                    <p className="text-sm font-medium leading-relaxed text-slate-600">
                      If an account exists for <span className="font-black text-slate-900">{recoveryEmail}</span>, recovery has
                      been requested.
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => setShowRecovery(false)}>
                    Back to login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleRecovery} className="space-y-5">
                  <div>
                    <label htmlFor="recovery-email" className="ui-label">
                      Email address
                    </label>
                    <input
                      id="recovery-email"
                      type="email"
                      required
                      value={recoveryEmail}
                      onChange={(e) => setRecoveryEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="ui-input"
                    />
                  </div>
                  {error ? <p className="ui-feedback ui-feedback-error">{error}</p> : null}
                  <div className="space-y-3">
                    <Button type="submit" loading={loading}>
                      Send recovery link
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setShowRecovery(false)}>
                      Back to login
                    </Button>
                  </div>
                </form>
              )
            ) : sent ? (
              <div className="space-y-5 text-center">
                <div className="flex justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-900">Check your email</h3>
                  <p className="text-sm font-medium leading-relaxed text-slate-600">
                    We&apos;ve sent a magic link to <span className="font-black text-slate-900">{email}</span>. Click the link to
                    finish signing in.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setSent(false)}>
                  Try another email
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-3">
                  {laloEnabled ? (
                    <>
                      <Button
                        leadingIcon={<MessageCircle className="h-4 w-4" />}
                        onClick={() => navigate('/auth/whatsapp/prep?from=/')}
                      >
                        Continue with WhatsApp
                      </Button>
                      <p className="text-center text-xs font-medium text-slate-400">Powered by Lalo</p>
                    </>
                  ) : null}

                  <Button variant="secondary" disabled title="Google sign-in will be connected soon.">
                    Continue with Google
                  </Button>

                  <Button variant={laloEnabled ? 'ghost' : 'primary'} onClick={() => setShowEmailLogin((prev) => !prev)}>
                    Continue with email
                  </Button>
                </div>

                {showEmailLogin ? (
                  <Card className="space-y-4 border-slate-200 bg-slate-50/70">
                    <div className="space-y-1">
                      <h3 className="text-base font-black text-slate-900">Email sign-in</h3>
                      <p className="text-sm font-medium text-slate-500">Use a magic link if you prefer email.</p>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div>
                        <label htmlFor="email" className="ui-label">
                          Email address
                        </label>
                        <input
                          id="email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="ui-input"
                        />
                      </div>

                      {error ? <p className="ui-feedback ui-feedback-error">{error}</p> : null}

                      <Button type="submit" loading={loading}>
                        Send magic link
                      </Button>
                    </form>
                  </Card>
                ) : null}
              </div>
            )}
          </Card>

          <div className="mt-6 space-y-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
              No account? One will be created for you.
            </p>
            {!showRecovery ? (
              <Button variant="ghost" onClick={() => setShowRecovery(true)}>
                Lost your guest bookings?
              </Button>
            ) : null}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
