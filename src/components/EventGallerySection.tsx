import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Flag, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { EventGalleryImage } from '../types';
import { ActivityImage, HERO_LANDSCAPE_COVER_RATIO_THRESHOLD } from './ActivityImage';

type Props = {
  images: EventGalleryImage[];
  title?: string;
  subtitle?: string;
  fullBleed?: boolean;
  reportable?: boolean;
  reportingImageId?: string | null;
  reportMessage?: string | null;
  onReport?: (imageId: string) => void | Promise<void>;
};

export function EventGallerySection({
  images,
  title = 'Gallery',
  subtitle,
  fullBleed = false,
  reportable = false,
  reportingImageId = null,
  reportMessage = null,
  onReport,
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  useEffect(() => {
    if (images.length === 0) {
      setSelectedIndex(0);
      setIsImageModalOpen(false);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, images.length - 1));
  }, [images.length]);

  useEffect(() => {
    if (!isImageModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsImageModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isImageModalOpen]);

  if (!images.length && !subtitle) return null;

  const selectedImage = images[selectedIndex] || null;
  const selectedImageRatio = (selectedImage?.width || 0) > 0 && (selectedImage?.height || 0) > 0
    ? Number(selectedImage?.width) / Number(selectedImage?.height)
    : null;
  const isClearlyLandscapeHero = selectedImageRatio !== null && selectedImageRatio >= HERO_LANDSCAPE_COVER_RATIO_THRESHOLD;
  const hasKnownContainedRatio = fullBleed && !isClearlyLandscapeHero && selectedImageRatio !== null && selectedImageRatio > 0;
  const heroHeightClass = fullBleed
    ? isClearlyLandscapeHero
      ? 'h-[18rem] sm:h-[22rem] md:h-[26rem]'
      : hasKnownContainedRatio
        ? ''
        : 'h-[22rem] sm:h-[24rem] md:h-[28rem]'
    : 'h-72';
  const heroHeightStyle = hasKnownContainedRatio
    ? {
        height: `clamp(22rem, ${(100 / selectedImageRatio!).toFixed(2)}vw, 32rem)`,
      }
    : undefined;
  const canReportSelected = !!(
    selectedImage
    && reportable
    && selectedImage.can_report
    && onReport
  );
  const goToPrevious = () => {
    if (images.length <= 1) return;
    setSelectedIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };
  const goToNext = () => {
    if (images.length <= 1) return;
    setSelectedIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <section className={fullBleed ? 'bg-white' : 'ui-card overflow-hidden'}>
      {images.length === 0 ? (
        <div className={fullBleed ? 'max-w-xl mx-auto px-6 py-5' : 'px-6 py-5'}>
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-7 text-center">
            <ImageIcon className="w-5 h-5 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500">{subtitle || 'No gallery images available yet.'}</p>
          </div>
          {reportMessage ? (
            <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">{reportMessage}</p>
          ) : null}
        </div>
      ) : (
        <>
          <div
            className={`relative ${selectedImage?.signed_url ? 'bg-transparent' : 'bg-slate-100'} ${heroHeightClass}`}
            style={heroHeightStyle}
          >
            {selectedImage?.signed_url ? (
              <ActivityImage
                src={selectedImage.signed_url}
                alt={selectedImage.original_file_name || 'Activity gallery image'}
                width={selectedImage.width}
                height={selectedImage.height}
                variant="hero"
                className="h-full w-full"
                loading="lazy"
                onClick={() => setIsImageModalOpen(true)}
              />
            ) : (
              <div className="h-full w-full bg-slate-100 flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-slate-400" />
              </div>
            )}

            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={goToPrevious}
                  aria-label="Previous gallery image"
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-700 shadow-sm backdrop-blur hover:bg-white"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={goToNext}
                  aria-label="Next gallery image"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-700 shadow-sm backdrop-blur hover:bg-white"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 right-3 rounded-full bg-slate-900/70 px-2.5 py-1 text-[11px] font-bold text-white">
                  {selectedIndex + 1} / {images.length}
                </div>
              </>
            ) : null}
          </div>

          {!fullBleed ? (
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
                    {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
                  </div>
                  {canReportSelected ? (
                    <button
                      type="button"
                      onClick={() => { void onReport?.(selectedImage.id); }}
                      disabled={reportingImageId === selectedImage.id}
                      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {reportingImageId === selectedImage.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Flag className="w-3 h-3" />
                      )}
                      Report image
                    </button>
                  ) : null}
                </div>

                {images.length > 1 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {images.map((image, index) => (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => setSelectedIndex(index)}
                        aria-label={`Show gallery image ${index + 1}`}
                        className={`h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 transition-all ${
                          index === selectedIndex ? 'border-brand-600' : 'border-transparent'
                        }`}
                      >
                        {image.signed_url ? (
                          <ActivityImage
                            src={image.signed_url}
                            alt={image.original_file_name || `Gallery thumbnail ${index + 1}`}
                            width={image.width}
                            height={image.height}
                            variant="thumbnail"
                            className="h-full w-full"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-slate-100">
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {reportMessage ? (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">{reportMessage}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {isImageModalOpen && selectedImage?.signed_url ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen gallery image"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-6"
          onClick={() => setIsImageModalOpen(false)}
        >
          <button
            type="button"
            onClick={() => setIsImageModalOpen(false)}
            className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            aria-label="Close fullscreen image"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="h-full w-full max-h-[calc(100dvh-1.5rem)] max-w-5xl sm:max-h-[calc(100dvh-3rem)]"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={selectedImage.signed_url}
              alt={selectedImage.original_file_name || 'Activity gallery image'}
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
