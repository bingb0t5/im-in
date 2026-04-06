import { useEffect, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { StateScreen } from '../components/ui/StateScreen';
import { accountMergeClient } from '../integrations/accountMerge/accountMergeClient';
import { supabase } from '../supabase';

const TRANSIENT_MERGE_ERROR_RE = /failed to send a request to the edge function|networkerror|load failed|fetch failed/i;

function formatMergeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Could not merge your accounts.';
  if (TRANSIENT_MERGE_ERROR_RE.test(message)) {
    return 'We could not reach the merge service yet. If this link opened inside an email app, reopen the latest merge link in your browser and try again.';
  }

  return message;
}

export default function AccountMergeComplete({ user: userFromApp }: { user: User | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Finishing your account merge...');
  const [error, setError] = useState<string | null>(null);
  const hasStartedRef = useRef(false);
  const [sessionMirrorUser, setSessionMirrorUser] = useState<User | null>(null);
  const requestId = searchParams.get('request') || '';
  const user = userFromApp ?? sessionMirrorUser;

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) {
        setSessionMirrorUser(session?.user ?? null);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionMirrorUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!requestId) {
      setStatus('error');
      setError('This merge link is missing its request details. Start again from your profile.');
      return;
    }

    if (!user || hasStartedRef.current) return;
    hasStartedRef.current = true;

    void (async () => {
      try {
        const result = await accountMergeClient.complete(requestId);
        setStatus('success');
        setMessage(`Merged into ${result.target_email}. Taking you back to your profile...`);
        window.setTimeout(() => {
          navigate('/profile', { replace: true });
        }, 1400);
      } catch (mergeError) {
        setStatus('error');
        setError(formatMergeError(mergeError));
      }
    })();
  }, [navigate, requestId, user]);

  if (!requestId) {
    return (
      <StateScreen
        badge="Merge Accounts"
        status="error"
        title="Merge link invalid"
        subtitle="Start the merge again from your profile."
        actions={<Button onClick={() => navigate('/profile', { replace: true })}>Back to profile</Button>}
      />
    );
  }

  if (!user) {
    return (
      <StateScreen
        badge="Merge Accounts"
        status="loading"
        title="Checking your email sign-in"
        subtitle="This page completes the merge after you open the magic link."
        helper="If nothing happens, make sure you opened the latest email link on this device."
      />
    );
  }

  if (status === 'success') {
    return (
      <StateScreen
        badge="Merge Accounts"
        status="success"
        title="Accounts merged"
        subtitle="Your email and WhatsApp are now on the same account."
        helper={message}
        icon={
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <CheckCircle2 className="h-7 w-7" />
          </div>
        }
      />
    );
  }

  if (status === 'error') {
    return (
      <StateScreen
        badge="Merge Accounts"
        status="error"
        title="Could not merge accounts"
        subtitle={error || 'Try starting the merge again from your profile.'}
        actions={<Button onClick={() => navigate('/profile', { replace: true })}>Back to profile</Button>}
      />
    );
  }

  return (
    <StateScreen
      badge="Merge Accounts"
      status="loading"
      title="Finishing your merge"
      subtitle="Please wait while we combine your accounts."
      helper={message}
    />
  );
}
