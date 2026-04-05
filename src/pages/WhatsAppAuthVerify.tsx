import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LaloVerifyFlow } from '../components/auth/LaloVerifyFlow';
import { LaloVerifyOverlay } from '../components/auth/LaloVerifyOverlay';
import {
  LALO_AUTH_POLL_INTERVAL_MS,
  clearAllLaloAuthState,
  finalizeLaloWhatsAppAuth,
  getLaloWhatsAppStatus,
  getStoredLaloAuthAttempt,
  isLaloWhatsAppAuthEnabled,
  isStoredLaloAttemptExpired,
  type StoredLaloAuthAttempt,
} from '../integrations/lalo/laloAuth';

type ParsedWhatsAppLinks = {
  appLink: string;
  webLink: string;
  phone: string;
  text: string;
  code: string;
};

function parseWhatsAppLinks(url: string): ParsedWhatsAppLinks {
  if (!url) {
    return {
      appLink: '',
      webLink: '',
      phone: '',
      text: '',
      code: '',
    };
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const phoneFromQuery = parsed.searchParams.get('phone') || '';
    const phoneFromPath = host === 'wa.me' ? parsed.pathname.replace(/\//g, '').trim() : '';
    const phone = phoneFromQuery || phoneFromPath;
    const text = parsed.searchParams.get('text') || '';
    const codeMatch = text.match(/LALO\s+VERIFY:\s*([A-Z0-9-]+)/i);
    const appLink = new URL('whatsapp://send');
    if (phone) appLink.searchParams.set('phone', phone);
    if (text) appLink.searchParams.set('text', text);
    const webLink = phone
      ? `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`
      : parsed.toString();

    return {
      appLink: phone || text ? appLink.toString() : '',
      webLink,
      phone,
      text,
      code: codeMatch?.[1] || '',
    };
  } catch {
    return {
      appLink: '',
      webLink: url,
      phone: '',
      text: '',
      code: '',
    };
  }
}

export default function WhatsAppAuthVerify() {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<StoredLaloAuthAttempt | null>(() => getStoredLaloAuthAttempt());
  const [attemptMode, setAttemptMode] = useState<'sign_in' | 'link_account'>(
    getStoredLaloAuthAttempt()?.mode === 'link_account' ? 'link_account' : 'sign_in',
  );
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [handoffStarted, setHandoffStarted] = useState(false);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const isBusyRef = useRef(false);

  const parsedWhatsApp = useMemo(
    () => parseWhatsAppLinks(attempt?.whatsappUrl || ''),
    [attempt?.whatsappUrl],
  );

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

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setHandoffStarted(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const isLinkMode = attemptMode === 'link_account';
  const returnPath = isLinkMode ? '/profile' : '/login';

  const goBack = () => {
    clearAllLaloAuthState();
    navigate(returnPath, { replace: true });
  };

  const finishSignIn = async (activeAttempt: StoredLaloAuthAttempt) => {
    setCompleting(true);
    setError(null);
    setOpenFailure(null);

    try {
      const result = await finalizeLaloWhatsAppAuth(activeAttempt);
      navigate('/auth/whatsapp/success', {
        replace: true,
        state: {
          redirectTo: result.redirectTo,
          isNewUser: result.isNewUser,
          mode: result.mode,
          merged: !!result.merged,
          whatsappNumber: result.whatsappNumber || activeAttempt.whatsappNumber || null,
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
      setCompleting(false);
    }
  };

  const runStatusCheck = async () => {
    if (!attempt || isBusyRef.current || completing) return;
    if (isStoredLaloAttemptExpired(attempt)) {
      setAttemptMode(attempt.mode);
      clearAllLaloAuthState();
      setExpired(true);
      setAttempt(null);
      return;
    }

    isBusyRef.current = true;

    try {
      const status = await getLaloWhatsAppStatus(attempt.attemptId);

      if (status.status === 'pending') {
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
    } catch {
      // Keep polling on transient network or edge-function failures.
      setError(null);
    } finally {
      isBusyRef.current = false;
    }
  };

  useEffect(() => {
    if (!attempt || expired || cancelled || completing) return;

    const initialCheckTimeout = window.setTimeout(() => {
      void runStatusCheck();
    }, 900);

    const intervalId = window.setInterval(() => {
      void runStatusCheck();
    }, LALO_AUTH_POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialCheckTimeout);
      window.clearInterval(intervalId);
    };
  }, [attempt, expired, cancelled, completing]);

  const openWhatsAppWebFallback = () => {
    if (!attempt?.whatsappUrl) return;

    setHandoffStarted(true);
    setOpenFailure(null);
    const fallbackUrl = parsedWhatsApp.webLink || attempt.whatsappUrl;
    const popup = window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    if (!popup) {
      window.location.href = fallbackUrl;
    }
  };

  const openWhatsAppHandoff = () => {
    if (!attempt?.whatsappUrl) return;

    setHandoffStarted(true);
    setOpenFailure(null);
    const fallbackUrl = parsedWhatsApp.webLink || attempt.whatsappUrl;

    try {
      if (parsedWhatsApp.appLink) {
        window.location.href = parsedWhatsApp.appLink;
        window.setTimeout(() => {
          if (document.visibilityState === 'visible') {
            const popup = window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
            if (!popup) {
              window.location.href = fallbackUrl;
            }
          }
        }, 700);
        return;
      }

      const popup = window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      if (!popup) {
        window.location.href = fallbackUrl;
      }
    } catch {
      setOpenFailure('Could not open WhatsApp automatically. Use the web fallback instead.');
    }
  };

  if (expired) {
    return (
      <LaloVerifyFlow>
        <LaloVerifyOverlay
          phase="idle"
          title="This login expired"
          description="Try again from the login screen."
          helperCard="Start a new WhatsApp verification attempt to continue."
          primaryAction={{
            label: isLinkMode ? 'Back to profile' : 'Back to login',
            onClick: goBack,
          }}
        />
      </LaloVerifyFlow>
    );
  }

  if (cancelled) {
    return (
      <LaloVerifyFlow>
        <LaloVerifyOverlay
          phase="idle"
          title="This login was cancelled"
          description="Start again when you're ready."
          helperCard="You can begin a fresh WhatsApp verification attempt from the login screen."
          primaryAction={{
            label: isLinkMode ? 'Back to profile' : 'Back to login',
            onClick: goBack,
          }}
        />
      </LaloVerifyFlow>
    );
  }

  if (!attempt) {
    return (
      <LaloVerifyFlow>
        <LaloVerifyOverlay
          phase="idle"
          title="No login attempt found"
          description={error || 'Start again from the login screen.'}
          primaryAction={{
            label: isLinkMode ? 'Back to profile' : 'Back to login',
            onClick: goBack,
          }}
        />
      </LaloVerifyFlow>
    );
  }

  const detailCard =
    parsedWhatsApp.phone || parsedWhatsApp.code ? (
      <div className="rounded-[1.35rem] border border-white/12 bg-white/10 px-4 py-3 text-left text-sm text-white/76">
        {parsedWhatsApp.phone ? (
          <p>
            <span className="text-white/46">To:</span> <span className="font-semibold text-white">{parsedWhatsApp.phone}</span>
          </p>
        ) : null}
        {parsedWhatsApp.code ? (
          <p className={parsedWhatsApp.phone ? 'mt-2' : ''}>
            <span className="text-white/46">Code:</span> <span className="font-semibold text-white">{parsedWhatsApp.code}</span>
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <LaloVerifyFlow>
      <LaloVerifyOverlay
        phase={completing ? 'verified' : handoffStarted ? 'waiting' : 'handoff'}
        expiresAt={attempt.expiresAt}
        verifiedNumber={completing ? attempt.whatsappNumber || null : null}
        description={completing ? 'Finalising your sign-in...' : undefined}
        primaryAction={
          completing
            ? undefined
            : {
                label: 'Send message to Lalo Verify using WhatsApp',
                onClick: openWhatsAppHandoff,
                icon: <MessageCircle className="h-4 w-4" />,
              }
        }
        helperCard={
          completing
            ? null
            : handoffStarted
              ? 'Waiting for your WhatsApp message and checking automatically...'
              : 'This opens WhatsApp with your Lalo Verify message already filled in.'
        }
        secondaryAction={
          completing
            ? undefined
            : {
                label: 'Open WhatsApp web fallback',
                onClick: openWhatsAppWebFallback,
              }
        }
        footerAction={{
          label: isLinkMode ? 'Back to profile' : 'Back to login',
          onClick: goBack,
        }}
        error={openFailure || error}
        detailCard={detailCard}
      />
    </LaloVerifyFlow>
  );
}
