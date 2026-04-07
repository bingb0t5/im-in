const MAIN_TABS_ROUTES = ['/', '/login', '/explore', '/calendar', '/changelog', '/create-event', '/my-activities', '/profile'];

export function isMainTabsRoute(pathname: string) {
  return MAIN_TABS_ROUTES.includes(pathname);
}

export function hasMainTabsSearchHeader(pathname: string) {
  return pathname === '/' || pathname === '/explore' || pathname === '/calendar';
}

export function showsMainTabsTopBar(pathname: string) {
  return pathname !== '/login' && pathname !== '/create-event';
}
