let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export async function registerAppServiceWorker() {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;

  if (!registrationPromise) {
    registrationPromise = (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        // Ensure the browser checks for updates during app boot.
        void registration.update();
        return registration;
      } catch (error) {
        console.error('Service worker registration failed:', error);
        registrationPromise = null;
        return null;
      }
    })();
  }

  return registrationPromise;
}
