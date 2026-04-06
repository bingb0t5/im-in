import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LaloVerifyFlowType } from '../vendor/lalo-verify';
import { LaloVerifyPanel } from '../vendor/lalo-verify/react';
import { Button } from '../components/ui/Button';
import { LaloVerifyFlow } from '../components/auth/LaloVerifyFlow';
import { completeWhatsAppAuth } from '../integrations/lalo/completeWhatsAppAuth';
import {
  clearAllLaloAuthState,
  getStoredLaloAuthAttempt,
  isLaloWhatsAppAuthEnabled,
} from '../integrations/lalo/laloAuth';
import { createImInLaloVerifyClient } from '../integrations/lalo/laloVerifyImInClient';
import { supabase } from '../supabase';

export default function WhatsAppAuthVerify() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const flowType: LaloVerifyFlowType = searchParams.get('mode') === 'login' ? 'login' : 'link_existing';
  const isLinkMode = flowType === 'link_existing';
  const returnTo = searchParams.get('returnTo') || (isLinkMode ? '/profile' : '/login');
  const autoStart = searchParams.get('autostart') === '1';
  const [isCheckingSession, setIsCheckingSession] = useState(isLinkMode);
  const verifyClient = useMemo(
    () =>
      createImInLaloVerifyClient({
        redirectTo: returnTo,
        imInMode: isLinkMode ? 'link_account' : 'sign_in',
      }),
    [isLinkMode, returnTo],
  );

  useEffect(() => {
    if (!isLaloWhatsAppAuthEnabled()) {
      navigate('/login', { replace: true });
      return;
    }

    if (!isLinkMode) {
      setIsCheckingSession(false);
      return;
    }

    let cancelled = false;

    const ensureSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        clearAllLaloAuthState();
        navigate('/profile?signin=true', { replace: true });
        return;
      }

      setIsCheckingSession(false);
    };

    void ensureSession();

    return () => {
      cancelled = true;
    };
  }, [isLinkMode, navigate]);

  const handleCompleted = useCallback(async () => {
    const attempt = getStoredLaloAuthAttempt();
    if (!attempt) {
      throw new Error('Verification finished but the session was lost. Try again.');
    }

    const result = await completeWhatsAppAuth(attempt);
    navigate(result.redirectTo || returnTo, { replace: true });
  }, [navigate, returnTo]);

  const getAuthToken = useCallback(async () => {
    if (!isLinkMode) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, [isLinkMode]);

  const backLabel = isLinkMode ? 'Back to profile' : 'Back to login';
  const title = 'Sign in with WhatsApp';
  const description = 'Powered by Lalo Verify';
  const buttonLabel = 'Continue with WhatsApp';
  const successDescription = isLinkMode
    ? 'Your WhatsApp number was recognized. Linking it to this account now.'
    : 'Your WhatsApp number was recognized. Completing your sign-in now.';

  return (
    <LaloVerifyFlow>
      <div className="fixed inset-x-0 top-1/2 z-10 -translate-y-1/2 px-4 sm:px-6">
        <div className="mx-auto w-full max-w-md space-y-3">
          <LaloVerifyPanel
            client={verifyClient}
            storageKeyPrefix="im_in_lalo_verify_route"
            flowType={flowType}
            autoStart={autoStart && !isCheckingSession}
            layout="cta"
            platformName="I'm In"
            title={title}
            description={description}
            buttonLabel={buttonLabel}
            successTitle="WhatsApp verified"
            successDescription={successDescription}
            idleBadge={null}
            getAuthToken={isLinkMode ? getAuthToken : undefined}
            onCompleted={handleCompleted}
          />

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              clearAllLaloAuthState();
              navigate(returnTo, { replace: true });
            }}
          >
            {backLabel}
          </Button>
        </div>
      </div>
    </LaloVerifyFlow>
  );
}
