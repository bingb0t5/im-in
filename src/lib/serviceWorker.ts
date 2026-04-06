export async function registerAppServiceWorker() {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    // Ensure the browser checks for updates during app boot.
    void registration.update();
    return registration;
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return null;
  }
}
