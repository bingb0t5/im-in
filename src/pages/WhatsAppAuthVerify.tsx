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
    }
    setError(null);

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
      setError(statusError instanceof Error ? statusError.message : 'Could not check WhatsApp sign in.');
    } finally {
      if (manual) {
        setChecking(false);
      }
      isBusyRef.current = false;
    }
  };

  useEffect(() => {
    if (!attempt || expired || cancelled || error || completing) return;

    void runStatusCheck(false);

    const intervalId = window.setInterval(() => {
      void runStatusCheck(false);
    }, LALO_AUTH_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [attempt, expired, cancelled, error, completing]);

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
