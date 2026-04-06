import { Navigate, useLocation } from 'react-router-dom';

export default function ModerationTransparency() {
  const location = useLocation();
  const nextParams = new URLSearchParams(location.search);
  nextParams.set('action', 'moderation');

  return <Navigate to={{ pathname: '/', search: `?${nextParams.toString()}` }} replace />;
}
