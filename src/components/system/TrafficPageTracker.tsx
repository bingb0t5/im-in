import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackTrafficPageview } from '../../lib/trafficAnalytics';

export default function TrafficPageTracker() {
  const location = useLocation();

  useEffect(() => {
    trackTrafficPageview(location.pathname);
  }, [location.pathname]);

  return null;
}
