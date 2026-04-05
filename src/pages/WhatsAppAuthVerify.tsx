import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { StateScreen } from '../components/ui/StateScreen';
import {
  LALO_AUTH_POLL_INTERVAL_MS,
  clearAllLaloAuthState,
  finalizeLaloWhatsAppAuth,
  getLaloWhatsAppStatus,
  getStoredLaloAuthAttempt,
  isLaloWhatsAppAuthEnabled,
  isStoredLaloAttemptExpired,
  mapLaloStatusToMessage,
  type StoredLaloAuthAttempt,
} from '../integrations/lalo/laloAuth';

export default function WhatsAppAuthVerify() {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<StoredLaloAuthAttempt | null>(() => getStoredLaloAuthAttempt());
  const [attemptMode, setAttemptMode] = useState<'sign_in' | 'link_account'>(
    getStoredLaloAuthAttempt()?.mode === 'link_account' ? 'link_account' : 'sign_in',
  );
  const [checking, setChecking] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [message, setMessage] = useState<string | null>('Please send the message in WhatsApp.');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const isBusyRef = useRef(false);
  const parsedWhatsapp = (() => {
    const url = attempt?.whatsappUrl || '';
    if (!url) return { phone: '', text: '', code: '' };
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const phoneFromQuery = parsed.searchParams.get('phone') || '';
      const phoneFromPath = host === 'wa.me'
        ? parsed.pathname.replace(/\//g, '').trim()
        : '';
      const phone = phoneFromQuery || phoneFromPath;
      const text = parsed.searchParams.get('text') || '';
      const codeMatch = text.match(/LALO\s+VERIFY:\s*([A-Z0-9-]+)/i);
      return {
        phone,
        text,
        code: codeMatch?.[1] || '',
      };
    } catch {
      return { phone: '', text: '', code: '' };
    }
  })();

  const openWhatsAppApp = () => {
    if (!attempt?.whatsappUrl) return;
    const deepLink = new URL('whatsapp://send');
    if (parsedWhatsapp.phone) deepLink.searchParams.set('phone', parsedWhatsapp.phone);
    if (parsedWhatsapp.text) deepLink.searchParams.set('text', parsedWhatsapp.text);
    // If parsing didn't produce useful fields, fallback to provided URL.
    window.location.href = parsedWhatsapp.phone || parsedWhatsapp.text
      ? deepLink.toString()
      : attempt.whatsappUrl;
  };

  const openWhatsAppWebFallback = () => {
    if (!attempt?.whatsappUrl) return;
    window.open(attempt.whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    if (!isLaloWhatsAppAuthEnabled()) {
      navigate('/login', { replace: true });
      return;
    }

    const storedAttempt = getStoredLaloAuthAttempt();
    if (!storedAttempt) {
      setError('This login attempt is missing. Start again.');
      return;
    }

    if (isStoredLaloAttemptExpired(storedAttempt)) {
      setAttemptMode(storedAttempt.mode);
      clearAllLaloAuthState();
      setAttempt(null);
      setExpired(true);
      return;
    }

    setAttemptMode(storedAttempt.mode);
    setAttempt(storedAttempt);
  }, [navigate]);

  const isLinkMode = attemptMode === 'link_account';
  const returnPath = isLinkMode ? '/profile' : '/login';

  const finishSignIn = async (activeAttempt: StoredLaloAuthAttempt) => {
    setCompleting(true);
    setError(null);
    setMessage(
      activeAttempt.mode === 'link_account'
        ? 'Verification complete. Linking WhatsApp to your account...'
        : 'Verification complete. Finishing sign in...',
    );

    try {
      const result = await finalizeLaloWhatsAppAuth(activeAttempt);
      navigate('/auth/whatsapp/success', {
        replace: true,
        state: {
          redirectTo: result.redirectTo,
          isNewUser: result.isNewUser,
          mode: result.mode,
          merged: !!result.merged,
        },
      });
    } catch (completionError) {
      setError(
        completionError instanceof Error
          ? completionError.message
          : activeAttempt.mode === 'link_account'
            ? 'Could not link WhatsApp to your account.'
            : 'Could not finish signing in.',
      );
    } finally {
      setCompleting(false);
    }
  };

  const runStatusCheck = async (manual = false) => {
    if (!attempt || isBusyRef.current || completing) return;
    if (isStoredLaloAttemptExpired(attempt)) {
      setAttemptMode(attempt.mode);
      clearAllLaloAuthState();
      setExpired(true);
      setAttempt(null);
      return;
    }

    isBusyRef.current = true;
    if (manual) {
      setChecking(true);
      setError(null);
    }

    try {
      const status = await getLaloWhatsAppStatus(attempt.attemptId);

      if (status.status === 'pending') {
        setMessage('Please send the message in WhatsApp.');
        return;
      }

      if (status.status === 'expired') {
        setAttemptMode(attempt.mode);
        clearAllLaloAuthState();
        setExpired(true);
        setAttempt(null);
        return;
      }

      if (status.status === 'cancelled') {
        setAttemptMode(attempt.mode);
        clearAllLaloAuthState();
        setCancelled(true);
        setAttempt(null);
        return;
      }

      await finishSignIn(attempt);
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : 'Could not check WhatsApp sign in.';
      // Auto polling should not hard-fail the screen on transient edge/network errors.
      // Keep polling and only surface the error when the user explicitly retries.
      if (manual) {
        setError(message);
      } else {
        setError(null);
        setMessage(mapLaloStatusToMessage('pending'));
      }
    } finally {
      if (manual) {
        setChecking(false);
      }
      isBusyRef.current = false;
    }
  };

  useEffect(() => {
    if (!attempt || expired || cancelled || completing) return;

    const initialCheckTimeout = window.setTimeout(() => {
      void runStatusCheck(false);
    }, 900);

    const intervalId = window.setInterval(() => {
      void runStatusCheck(false);
    }, LALO_AUTH_POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialCheckTimeout);
      window.clearInterval(intervalId);
    };
  }, [attempt, expired, cancelled, completing]);

  if (expired) {
    return (
      <StateScreen
        badge="WhatsApp Sign In"
        status="error"
        title="This login expired"
        subtitle="Try again from the login screen."
        helper="Start a new WhatsApp verification attempt to continue."
        actions={
          <Button onClick={() => navigate(returnPath, { replace: true })}>
            {isLinkMode ? 'Back to profile' : 'Back to login'}
          </Button>
        }
      />
    );
  }

  if (cancelled) {
    return (
      <StateScreen
        badge="WhatsApp Sign In"
        status="error"
        title="This login was cancelled"
        subtitle="Start again when you're ready."
        helper="You can begin a fresh WhatsApp verification attempt from the login screen."
        actions={
          <Button onClick={() => navigate(returnPath, { replace: true })}>
            {isLinkMode ? 'Back to profile' : 'Back to login'}
          </Button>
        }
      />
    );
  }

  if (!attempt) {
    return (
      <StateScreen
        badge="WhatsApp Sign In"
        status="error"
        title="No login attempt found"
        subtitle={error || 'Start again from the login screen.'}
        actions={
          <Button onClick={() => navigate(returnPath, { replace: true })}>
            {isLinkMode ? 'Back to profile' : 'Back to login'}
          </Button>
        }
      />
    );
  }

  return (
    <StateScreen
      badge="WhatsApp Sign In"
      status={error ? 'error' : 'loading'}
      title={completing ? 'Finishing sign in' : 'Checking...'}
            subtitle={
              completing
                ? isLinkMode
                  ? 'Saving your WhatsApp verification'
                  : 'Creating your session'
                : 'Verifying your message'
            }
      helper={
        error
          ? mapLaloStatusToMessage('pending')
          : 'Return here after sending the WhatsApp message. We will keep checking automatically.'
      }
      actions={
        <>
          {error ? (
            <Card className="ui-feedback ui-feedback-error text-left">
              <p>{error}</p>
            </Card>
          ) : null}
          {message ? (
            <Card className="ui-feedback ui-feedback-info text-left">
              <p>{message}</p>
            </Card>
          ) : null}
          {!completing ? (
            <Card className="ui-feedback ui-feedback-info text-left">
              <p className="font-bold text-slate-700">Step 1: Open WhatsApp and send the message.</p>
              {parsedWhatsapp.phone ? <p className="mt-1 text-xs text-slate-500">To: {parsedWhatsapp.phone}</p> : null}
              {parsedWhatsapp.code ? <p className="mt-1 text-xs text-slate-500">Code: {parsedWhatsapp.code}</p> : null}
              <div className="mt-3 space-y-2">
                <Button variant="secondary" onClick={openWhatsAppApp}>
                  Open WhatsApp app
                </Button>
                <Button variant="ghost" onClick={openWhatsAppWebFallback}>
                  Open WhatsApp web fallback
                </Button>
              </div>
            </Card>
          ) : null}
          <Button loading={checking || completing} onClick={() => void runStatusCheck(true)}>
            I've sent it, check again
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              clearAllLaloAuthState();
              navigate(returnPath);
            }}
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
          >
            {isLinkMode ? 'Back to profile' : 'Back to login'}
          </Button>
        </>
      }
    />
  );
}
