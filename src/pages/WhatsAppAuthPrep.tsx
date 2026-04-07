import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isLaloWhatsAppAuthEnabled } from '../integrations/lalo/laloAuth';

export default function WhatsAppAuthPrep() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('returnTo') || searchParams.get('from') || '/';

  useEffect(() => {
    if (!isLaloWhatsAppAuthEnabled()) {
      navigate('/login', { replace: true });
      return;
    }
    navigate(`/auth/whatsapp/verify?mode=login&autostart=1&returnTo=${encodeURIComponent(redirectTo)}`, { replace: true });
  }, [navigate, redirectTo]);

  return null;
}
