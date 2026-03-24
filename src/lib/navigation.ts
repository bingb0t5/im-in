import { NavigateFunction } from 'react-router-dom';

export function goBackOr(navigate: NavigateFunction, fallbackPath: string) {
  const historyState = window.history.state as { idx?: number } | null;
  if (typeof historyState?.idx === 'number' && historyState.idx > 0) {
    navigate(-1);
    return;
  }

  navigate(fallbackPath, { replace: true });
}
