import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LaloVerifyFlow } from '../components/auth/LaloVerifyFlow';
import { LaloVerifyOverlay } from '../components/auth/LaloVerifyOverlay';

export default function WhatsAppAuthSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = typeof location.state?.redirectTo === 'string' ? location.state.redirectTo : '/';
  const whatsappNumber = typeof location.state?.whatsappNumber === 'string' ? location.state.whatsappNumber : null;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      navigate(redirectTo, { replace: true });
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, redirectTo]);

  return (
    <LaloVerifyFlow>
      <LaloVerifyOverlay
        phase="verified"
        description="Finalising your sign-in..."
        verifiedNumber={whatsappNumber}
      />
    </LaloVerifyFlow>
  );
}
