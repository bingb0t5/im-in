import { useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { StateScreen } from '../components/ui/StateScreen';

export default function WhatsAppAuthSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = typeof location.state?.redirectTo === 'string' ? location.state.redirectTo : '/';
  const mode = location.state?.mode === 'link_account' ? 'link_account' : 'sign_in';
  const merged = !!location.state?.merged;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      navigate(redirectTo, { replace: true });
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, redirectTo]);

  return (
    <StateScreen
      badge="WhatsApp Sign In"
      status="success"
      title={mode === 'link_account' ? 'WhatsApp linked' : "You're in"}
      subtitle={
        mode === 'link_account'
          ? merged
            ? 'WhatsApp linked and your duplicate account was merged'
            : 'Your account now has WhatsApp verification'
          : 'Signed in with WhatsApp'
      }
      helper={mode === 'link_account' ? 'Taking you back to your profile.' : 'Taking you back now.'}
      icon={
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <CheckCircle2 className="h-7 w-7" />
        </div>
      }
    />
  );
}
