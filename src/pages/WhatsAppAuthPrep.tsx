import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LaloVerifyFlow } from '../components/auth/LaloVerifyFlow';
import { LaloVerifyOverlay, type LaloVerifyPhase } from '../components/auth/LaloVerifyOverlay';
import { clearAllLaloAuthState, isLaloWhatsAppAuthEnabled, startLaloWhatsAppAuth } from '../integrations/lalo/laloAuth';

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function WhatsAppAuthPrep() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<LaloVerifyPhase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const redirectTo = searchParams.get('from') || '/';

  useEffect(() => {
    if (!isLaloWhatsAppAuthEnabled()) {
      navigate('/login', { replace: true });
      return;
    }

    let cancelled = false;

    const run = async () => {
      setError(null);
      setPhase('connecting');
      clearAllLaloAuthState();

      try {
        await sleep(220);
        if (cancelled) return;

        setPhase('generating');
        await sleep(180);
        if (cancelled) return;

        await startLaloWhatsAppAuth(redirectTo);
        if (cancelled) return;

        navigate('/auth/whatsapp/verify', { replace: true });
      } catch (startError) {
        if (cancelled) return;
        setError(startError instanceof Error ? startError.message : 'Could not start WhatsApp sign in.');
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [navigate, redirectTo]);

  return (
    <LaloVerifyFlow>
      {error ? (
        <LaloVerifyOverlay
          phase="idle"
          title="Couldn't start WhatsApp sign in"
          description="Check the Lalo configuration or try again in a moment."
          error={error}
          primaryAction={{
            label: 'Try again',
            onClick: () => window.location.reload(),
          }}
          footerAction={{
            label: 'Back to login',
            onClick: () => navigate('/login', { replace: true }),
          }}
        />
      ) : (
        <LaloVerifyOverlay
          phase={phase}
          footerAction={{
            label: 'Back to login',
            onClick: () => navigate('/login', { replace: true }),
          }}
        />
      )}
    </LaloVerifyFlow>
  );
}
