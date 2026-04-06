export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Build `whatsapp://send?...` from a standard wa.me or api.whatsapp.com URL. */
export function buildWhatsAppAppLink(webLink: string): string | null {
  try {
    const url = new URL(webLink);
    let phone = '';
    let text = '';

    if (url.hostname === 'wa.me') {
      phone = url.pathname.replace(/\//g, '').trim();
      text = url.searchParams.get('text') || '';
    } else if (url.hostname === 'api.whatsapp.com') {
      phone = url.searchParams.get('phone') || '';
      text = url.searchParams.get('text') || '';
    } else {
      return null;
    }

    const params = new URLSearchParams();
    if (phone) params.set('phone', phone);
    if (text) params.set('text', text);

    return `whatsapp://send?${params.toString()}`;
  } catch {
    return null;
  }
}
