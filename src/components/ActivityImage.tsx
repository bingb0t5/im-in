import { useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

type ActivityImageVariant = 'hero' | 'thumbnail';

type Props = {
  src: string;
  alt: string;
  variant?: ActivityImageVariant;
  width?: number | null;
  height?: number | null;
  className?: string;
  loading?: 'lazy' | 'eager';
  onClick?: () => void;
};

export const HERO_LANDSCAPE_COVER_RATIO_THRESHOLD = 1.4;

function joinClasses(...parts: Array<string | null | undefined | false>) {
  return parts.filter(Boolean).join(' ');
}

export function ActivityImage({
  src,
  alt,
  variant = 'hero',
  width,
  height,
  className,
  loading = 'lazy',
  onClick,
}: Props) {
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);

  const ratio = useMemo(() => {
    if ((width || 0) > 0 && (height || 0) > 0) {
      return Number(width) / Number(height);
    }
    if ((naturalDimensions?.width || 0) > 0 && (naturalDimensions?.height || 0) > 0) {
      return naturalDimensions!.width / naturalDimensions!.height;
    }
    return null;
  }, [height, naturalDimensions, width]);

  const shouldContainHero = variant === 'hero' && (ratio === null || ratio < HERO_LANDSCAPE_COVER_RATIO_THRESHOLD);
  const canInteract = Boolean(onClick) && !hasLoadError;

  const imageElement = hasLoadError ? (
    <div className="flex h-full w-full items-center justify-center bg-slate-100">
      <ImageIcon className="h-8 w-8 text-slate-400" aria-hidden="true" />
    </div>
  ) : (
    <>
      {shouldContainHero ? (
        <>
          <img
            src={src}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover blur-3xl opacity-90"
          />
        </>
      ) : null}
      <img
        src={src}
        alt={alt}
        width={width || undefined}
        height={height || undefined}
        loading={loading}
        onLoad={(event) => {
          setHasLoadError(false);
          const target = event.currentTarget;
          const nextWidth = target.naturalWidth || 0;
          const nextHeight = target.naturalHeight || 0;
          if (nextWidth > 0 && nextHeight > 0) {
            setNaturalDimensions({ width: nextWidth, height: nextHeight });
          }
        }}
        onError={() => {
          setHasLoadError(true);
          setNaturalDimensions(null);
        }}
        className={joinClasses(
          'relative h-full w-full',
          variant === 'thumbnail'
            ? 'object-cover object-center'
            : shouldContainHero
              ? 'object-contain'
              : 'object-cover object-center',
        )}
      />
    </>
  );

  if (canInteract) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={joinClasses(
          'relative block h-full w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
          className,
        )}
        aria-label="Open full image"
      >
        {imageElement}
      </button>
    );
  }

  return (
    <div className={joinClasses('relative h-full w-full overflow-hidden', className)}>
      {imageElement}
    </div>
  );
}
