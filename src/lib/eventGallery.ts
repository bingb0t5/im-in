export const EVENT_GALLERY_BUCKET = 'event-gallery';
export const EVENT_GALLERY_MAX_IMAGE_COUNT = 8;
export const EVENT_GALLERY_MAX_FILE_BYTES = 8 * 1024 * 1024;
const BROWSER_SAFE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);
const SUPPORTED_EXTENSION_RE = /\.(jpe?g|png|webp|heic|heif)$/i;
const HEIC_EXTENSION_RE = /\.(heic|heif)$/i;

type Heic2Any = (options: {
  blob: Blob;
  toType: string;
  quality?: number;
}) => Promise<Blob | Blob[]>;

function getCryptoObject() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.crypto ?? null;
}

export function createClientSideId() {
  const cryptoObject = getCryptoObject();
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  if (typeof cryptoObject?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileExtensionFromMimeType(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function sanitizeFileName(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeMimeType(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function hasSupportedExtension(fileName?: string | null) {
  return SUPPORTED_EXTENSION_RE.test((fileName || '').trim());
}

export function isHeicLikeFile(file: Pick<File, 'type' | 'name'>) {
  const mimeType = normalizeMimeType(file.type);
  return HEIC_MIME_TYPES.has(mimeType) || HEIC_EXTENSION_RE.test((file.name || '').trim());
}

export function validateEventGalleryFile(file: File) {
  const mimeType = normalizeMimeType(file.type);
  const isBrowserSafe = BROWSER_SAFE_MIME_TYPES.has(mimeType);
  const isHeic = isHeicLikeFile(file);

  if (!isBrowserSafe && !isHeic && !hasSupportedExtension(file.name)) {
    throw new Error('Only JPG, PNG, WEBP, or iPhone HEIC photos are supported.');
  }
  if (file.size > 30 * 1024 * 1024) {
    throw new Error('Each image must be 30MB or smaller before optimization.');
  }
}

export function buildEventGalleryStoragePath(eventId: string, extension: string) {
  const safeEventId = (eventId || '').trim();
  const ext = sanitizeFileName(extension || '').replace('.', '') || 'jpg';
  return `${safeEventId}/${createClientSideId()}.${ext}`;
}

function loadImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      URL.revokeObjectURL(url);
      if (!width || !height) {
        reject(new Error('Could not read image dimensions.'));
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image.'));
    };
    image.src = url;
  });
}

async function convertHeicToJpeg(file: File): Promise<Blob> {
  const module = await import('heic2any');
  const heic2any = (module.default ?? module) as Heic2Any;
  const output = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.9,
  });
  const converted = Array.isArray(output) ? output[0] : output;
  if (!(converted instanceof Blob)) {
    throw new Error('Could not convert this HEIC photo.');
  }
  return converted.type === 'image/jpeg'
    ? converted
    : new Blob([converted], { type: 'image/jpeg' });
}

function renderImageToJpegBlob(
  blob: Blob,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not prepare image for upload.'));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((nextBlob) => {
        URL.revokeObjectURL(url);
        if (!nextBlob) {
          reject(new Error('Could not optimize image for upload.'));
          return;
        }
        resolve(nextBlob);
      }, 'image/jpeg', quality);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not optimize image for upload.'));
    };
    image.src = url;
  });
}

async function shrinkImageToFitLimit(blob: Blob, startingWidth: number, startingHeight: number) {
  const attempts = [
    { scale: 1, quality: 0.86 },
    { scale: 0.92, quality: 0.82 },
    { scale: 0.84, quality: 0.78 },
    { scale: 0.76, quality: 0.72 },
    { scale: 0.68, quality: 0.66 },
  ];

  let bestBlob = blob;
  for (const attempt of attempts) {
    const width = Math.max(1, Math.round(startingWidth * attempt.scale));
    const height = Math.max(1, Math.round(startingHeight * attempt.scale));
    const candidate = await renderImageToJpegBlob(blob, width, height, attempt.quality);
    bestBlob = candidate;
    if (candidate.size <= EVENT_GALLERY_MAX_FILE_BYTES) {
      return bestBlob;
    }
  }
  return bestBlob;
}

export async function sanitizeEventGalleryFile(file: File): Promise<{
  blob: Blob;
  extension: string;
  contentType: string;
  width: number;
  height: number;
}> {
  validateEventGalleryFile(file);
  const normalizedMimeType = normalizeMimeType(file.type);
  const shouldConvertHeic = isHeicLikeFile(file);
  let blob = shouldConvertHeic ? await convertHeicToJpeg(file) : file;
  let contentType = shouldConvertHeic
    ? 'image/jpeg'
    : BROWSER_SAFE_MIME_TYPES.has(normalizedMimeType)
      ? normalizedMimeType
      : 'image/jpeg';
  let dimensions = await loadImageDimensions(blob);

  if (blob.size > EVENT_GALLERY_MAX_FILE_BYTES) {
    blob = await shrinkImageToFitLimit(blob, dimensions.width, dimensions.height);
    contentType = 'image/jpeg';
    dimensions = await loadImageDimensions(blob);
  }

  if (blob.size > EVENT_GALLERY_MAX_FILE_BYTES) {
    throw new Error('One of those images is still too large after optimization. Please choose a smaller photo.');
  }

  return {
    blob,
    extension: fileExtensionFromMimeType(contentType),
    contentType,
    width: dimensions.width,
    height: dimensions.height,
  };
}
