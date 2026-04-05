export type InAppBrowserKind =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'facebook'
  | 'generic_webview'
  | null;

export type MobilePlatform = 'ios' | 'android' | 'other';

export type RuntimeEnvironment = {
  isBrowser: boolean;
  userAgent: string;
  isMobile: boolean;
  platform: MobilePlatform;
  isStandalone: boolean;
  inAppBrowserKind: InAppBrowserKind;
  isInAppBrowser: boolean;
  isSafari: boolean;
  isChrome: boolean;
};

function getStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function detectInAppBrowserKind(userAgent: string, isMobile: boolean): InAppBrowserKind {
  const ua = userAgent.toLowerCase();
  if (!isMobile) return null;

  if (ua.includes('whatsapp')) return 'whatsapp';
  if (ua.includes('instagram')) return 'instagram';
  if (ua.includes('messenger') || ua.includes('fb_iab/messenger')) return 'messenger';
  if (ua.includes('fb_iab') || ua.includes('fban') || ua.includes('fbav')) return 'facebook';

  // Webview detection is heuristic and may have false positives/negatives.
  const androidWebview = ua.includes('; wv') || ua.includes(' version/') && ua.includes(' chrome/');
  const iosWebview =
    /(iphone|ipad|ipod)/i.test(userAgent)
    && /applewebkit/i.test(userAgent)
    && !/safari/i.test(userAgent);
  if (androidWebview || iosWebview) return 'generic_webview';

  return null;
}

export function detectRuntimeEnvironment(): RuntimeEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isBrowser: false,
      userAgent: '',
      isMobile: false,
      platform: 'other',
      isStandalone: false,
      inAppBrowserKind: null,
      isInAppBrowser: false,
      isSafari: false,
      isChrome: false,
    };
  }

  const userAgent = navigator.userAgent || '';
  const ua = userAgent.toLowerCase();
  const isIOS = /(iphone|ipad|ipod)/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  const isMobile = isIOS || isAndroid;
  const platform: MobilePlatform = isIOS ? 'ios' : isAndroid ? 'android' : 'other';
  const inAppBrowserKind = detectInAppBrowserKind(userAgent, isMobile);
  const isInAppBrowser = inAppBrowserKind !== null;
  const isStandalone = getStandaloneDisplayMode();
  const isChrome = /(chrome|crios)/i.test(userAgent) && !/(edg|opr|opera)/i.test(userAgent);
  const isSafari =
    /safari/i.test(userAgent)
    && !/(chrome|crios|fxios|edgios|edg|opr|opera)/i.test(userAgent)
    && !isInAppBrowser;

  return {
    isBrowser: true,
    userAgent: ua,
    isMobile,
    platform,
    isStandalone,
    inAppBrowserKind,
    isInAppBrowser,
    isSafari,
    isChrome,
  };
}

export function getAddToHomeScreenInstructions(env: RuntimeEnvironment): string[] {
  if (env.platform === 'ios') {
    if (env.isSafari) {
      return [
        'Tap the Share button in Safari.',
        'Choose "Add to Home Screen".',
        'Tap Add to save I\'m In on your Home Screen.',
      ];
    }
    return [
      'Open this page in Safari first.',
      'Tap the Share button.',
      'Choose "Add to Home Screen", then tap Add.',
    ];
  }

  if (env.platform === 'android') {
    if (env.isChrome && !env.isInAppBrowser) {
      return [
        'Tap the browser menu (three dots).',
        'Choose "Add to Home screen" or "Install app".',
        'Confirm to place I\'m In on your Home Screen.',
      ];
    }
    return [
      'Open this page in Chrome first.',
      'Tap the browser menu (three dots).',
      'Choose "Add to Home screen" or "Install app".',
    ];
  }

  return [
    'Open this page in your main browser.',
    'Use the browser menu to add I\'m In to your Home Screen.',
  ];
}
