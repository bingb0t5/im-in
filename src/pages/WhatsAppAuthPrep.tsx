import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { StateScreen } from '../components/ui/StateScreen';
import { clearAllLaloAuthState, isLaloWhatsAppAuthEnabled, startLaloWhatsAppAuth } from '../integrations/lalo/laloAuth';

export default function WhatsAppAuthPrep() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
      clearAllLaloAuthState();

      try {
        const attempt = await startLaloWhatsAppAuth(redirectTo);
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

  if (error) {
    return (
      <StateScreen
        badge="WhatsApp Sign In"
        status="error"
        title="Couldn't start WhatsApp sign in"
        subtitle={error}
        helper="Check the Lalo configuration or try again in a moment."
        actions={
          <>
            <Button onClick={() => window.location.reload()}>Try again</Button>
            <Button variant="secondary" onClick={() => navigate('/login')}>
              Back to login
            </Button>
          </>
        }
      />
    );
  }

  return (
    <StateScreen
      badge="WhatsApp Sign In"
      status="loading"
      title="Verifying your account"
      subtitle="Opening WhatsApp..."
      helper="Send the message in WhatsApp, then return here to finish signing in."
      actions={
        <Button variant="secondary" onClick={() => navigate('/login')}>
          Cancel
        </Button>
      }
    />
  );
}
