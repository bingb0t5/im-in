import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { motion } from 'motion/react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LaloVerifyPanel } from '../generated/lalo-verify/react';
import { buildAuthRedirectUrl } from '../lib/authRedirect';
import { Button } from '../components/ui/Button';
import {
  clearAllLaloAuthState,
  getStoredLaloAuthAttempt,
  isLaloWhatsAppAuthEnabled,
} from '../integrations/lalo/laloAuth';
import { completeWhatsAppAuth } from '../integrations/lalo/completeWhatsAppAuth';
import { createImInLaloVerifyClient } from '../integrations/lalo/laloVerifyImInClient';
import { supabase } from '../supabase';

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
  const redirectFrom = searchParams.get('from') || '/';
  const imInVerifyClient = useMemo(
    () => createImInLaloVerifyClient({ redirectTo: redirectFrom, imInMode: 'sign_in' }),
    [redirectFrom],
  );

  const handleWhatsAppVerified = useCallback(async () => {
    try {
      const attempt = getStoredLaloAuthAttempt();
      if (!attempt) {
        setError('Verification finished but the session was lost. Try again.');
        return;
      }
      const result = await completeWhatsAppAuth(attempt);
      console.info('[identity-debug] login:whatsapp-verified-navigate', {
        attemptRedirectTo: attempt.redirectTo,
        resultRedirectTo: result.redirectTo || '/',
      });
      navigate(result.redirectTo || '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish signing in.');
    }
  }, [navigate]);

  useEffect(() => {
    if (searchParams.get('recovery') === 'true') {
      setShowRecovery(true);
    }
    if (searchParams.get('withEmail') === '1' || searchParams.get('withEmail') === 'true') {
      setShowEmailLogin(true);
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

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: loginError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: buildAuthRedirectUrl(redirectFrom.startsWith('/') ? redirectFrom : '/'),
      },
    });

    if (loginError) {
      setError(loginError.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  const handleRecovery = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const normalizedEmail = recoveryEmail.trim().toLowerCase();
      const { error: recoveryError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: buildAuthRedirectUrl('/'),
        },
      });
      if (recoveryError) throw recoveryError;
      setRecoverySent(true);
      setRecoveryEmail(normalizedEmail);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send recovery link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100svh-7rem)] bg-slate-50">
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
      <div className="flex min-h-[calc(100svh-7rem)] flex-col justify-center py-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex w-full flex-col"
        >
          <div className="mx-auto w-full max-w-lg space-y-4 px-6 pb-6 text-center">
            <div className="flex justify-center">
              <img src="/im-in-svg-logo-size.svg" alt="I'm In" className="h-24 w-auto" />
            </div>
            <p className="text-center text-sm font-semibold leading-tight text-slate-500">
              See what&apos;s on. Say <span className="italic">I&apos;m In.</span>
            </p>
            <div className="space-y-2">
              {showRecovery ? <h2 className="text-2xl font-black tracking-tight text-slate-900">Find my bookings</h2> : null}
              <p className="text-sm font-medium leading-relaxed text-slate-500">
                {showRecovery
                  ? 'Enter your email to get a recovery link.'
                  : laloEnabled
                    ? 'Sign in (or create an account) securely using WhatsApp below. Alternatively you can sign in with email.'
                    : 'Sign in (or create an account) securely using your email below.'}
              </p>
            </div>
          </div>

          <div className="w-full space-y-6 px-4 sm:px-5">
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
                      <LaloVerifyPanel
                        client={imInVerifyClient}
                        storageKeyPrefix="im_in_lalo_verify_ui"
                        flowType="login"
                        layout="cta"
                        platformName="I'm In"
                        title="Sign in with WhatsApp"
                        description="Secure verification for your account"
                        buttonLabel="Continue with WhatsApp"
                        successTitle="WhatsApp verified"
                        successDescription="Your WhatsApp number was recognized. Completing your sign-in now."
                        idleBadge={null}
                        onCompleted={handleWhatsAppVerified}
                      />
                      {error && !showEmailLogin ? (
                        <p className="ui-feedback ui-feedback-error text-center text-sm">{error}</p>
                      ) : null}
                    </>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailLogin((prev) => !prev || !laloEnabled);
                      setError(null);
                    }}
                    className="block w-full max-w-none rounded-[2rem] border border-slate-200/90 bg-white px-4 py-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition-transform duration-150 hover:-translate-y-0.5 sm:px-5 sm:py-4"
                  >
                    <span className="flex items-center gap-4">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.15rem] border border-brand-100/80 bg-brand-50 text-brand-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                        <Mail className="h-6 w-6" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-lg font-black tracking-tight text-slate-900">Continue with email</span>
                        <span className="mt-0.5 block text-sm font-medium text-slate-500">Backup sign-in options</span>
                      </span>
                    </span>
                  </button>
                </div>

                {showEmailLogin ? (
                  <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
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
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-6 space-y-3 px-6 text-center">
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
