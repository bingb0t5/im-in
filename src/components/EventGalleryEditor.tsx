import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { EventGalleryImage, EventGalleryVisibility } from '../types';
import { EVENT_GALLERY_MAX_IMAGE_COUNT } from '../lib/eventGallery';

export type QueuedGalleryUpload = {
  id: string;
  file: File;
  previewUrl: string;
};

type Props = {
  eventVisibility: 'public' | 'semi_public' | 'private';
  galleryVisibility: EventGalleryVisibility;
  images: EventGalleryImage[];
  queuedUploads: QueuedGalleryUpload[];
  canUpload: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  onGalleryVisibilityChange: (value: EventGalleryVisibility) => void;
  onPickFiles: (files: FileList | null) => void;
  onRemoveExisting: (imageId: string) => void;
  onRemoveQueued: (uploadId: string) => void;
};

function statusBadgeClass(status: EventGalleryImage['public_visibility_status']) {
  switch (status) {
    case 'approved':
      return 'bg-brand-50 text-brand-700 border border-brand-100';
    case 'pending':
      return 'bg-amber-50 text-amber-700 border border-amber-100';
    case 'blocked':
      return 'bg-red-50 text-red-700 border border-red-100';
    case 'report_hidden':
      return 'bg-slate-100 text-slate-700 border border-slate-200';
    case 'error':
      return 'bg-slate-100 text-slate-700 border border-slate-200';
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200';
  }
}

function statusLabel(status: EventGalleryImage['public_visibility_status']) {
  switch (status) {
    case 'approved':
      return 'Public preview approved';
    case 'pending':
      return 'Public preview pending';
    case 'blocked':
      return 'Public preview blocked';
    case 'report_hidden':
      return 'Hidden from public preview';
    case 'error':
      return 'Moderation error';
    default:
      return 'Private only';
  }
}

export function EventGalleryEditor({
  eventVisibility,
  galleryVisibility,
  images,
  queuedUploads,
  canUpload,
  isLoading,
  errorMessage,
  onGalleryVisibilityChange,
  onPickFiles,
  onRemoveExisting,
  onRemoveQueued,
}: Props) {
  const isPrivateVisibility = eventVisibility === 'private';
  const totalImages = images.length + queuedUploads.length;
  const canAddMore = totalImages < EVENT_GALLERY_MAX_IMAGE_COUNT;

  return (
    <section className="ui-card overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Activity photos</h3>
        <p className="text-sm text-slate-500 mt-1">
          Add up to {EVENT_GALLERY_MAX_IMAGE_COUNT} images to help guests understand what to expect.
        </p>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Public visibility for photos
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onGalleryVisibilityChange('private_only')}
              disabled={isPrivateVisibility || isLoading}
              className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                galleryVisibility === 'private_only'
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <p className="text-sm font-bold text-slate-900">Private only</p>
              <p className="text-xs text-slate-500 mt-1">Visible only to host/private-access viewers.</p>
            </button>
            <button
              type="button"
              onClick={() => onGalleryVisibilityChange('public_preview')}
              disabled={isPrivateVisibility || isLoading}
              className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                galleryVisibility === 'public_preview'
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              } ${isPrivateVisibility || isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <p className="text-sm font-bold text-slate-900">Public preview</p>
              <p className="text-xs text-slate-500 mt-1">Approved images can appear on the public preview.</p>
            </button>
          </div>
          {isPrivateVisibility ? (
            <p className="text-xs text-slate-500">
              Private activities always keep gallery images private.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-slate-500" />
            <p className="text-sm font-semibold text-slate-700">{totalImages} / {EVENT_GALLERY_MAX_IMAGE_COUNT} selected</p>
          </div>
          <label className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all ${
            canUpload && canAddMore && !isLoading
              ? 'bg-brand-600 text-white hover:bg-brand-500 cursor-pointer'
              : 'bg-slate-200 text-slate-500 cursor-not-allowed'
          }`}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Add photos
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
              multiple
              disabled={!canUpload || !canAddMore || isLoading}
              className="hidden"
              onChange={(event) => {
                onPickFiles(event.target.files);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        {errorMessage ? (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
            {errorMessage}
          </div>
        ) : null}

        <p className="text-xs text-slate-500">
          JPG, PNG, WEBP, and iPhone HEIC photos are supported. Large photos are optimized automatically before saving.
        </p>

        {images.length === 0 && queuedUploads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-slate-600">No gallery images yet.</p>
            <p className="text-xs text-slate-500 mt-1">JPG, PNG, WEBP, HEIC. Large photos are optimized automatically.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {images.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saved images</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {images.map((image) => (
                    <div key={image.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                      {image.signed_url ? (
                        <img
                          src={image.signed_url}
                          alt={image.original_file_name || 'Saved gallery image'}
                          className="w-full h-28 object-cover"
                        />
                      ) : (
                        <div className="w-full h-28 bg-slate-100 flex items-center justify-center text-xs text-slate-500 px-2 text-center">
                          Image preview unavailable
                        </div>
                      )}
                      <div className="p-2 space-y-2">
                        <p className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(image.public_visibility_status)}`}>
                          {statusLabel(image.public_visibility_status)}
                        </p>
                        <button
                          type="button"
                          onClick={() => onRemoveExisting(image.id)}
                          disabled={isLoading}
                          className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {queuedUploads.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Queued uploads</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {queuedUploads.map((upload) => (
                    <div key={upload.id} className="rounded-2xl border border-brand-100 bg-brand-50 overflow-hidden">
                      <img src={upload.previewUrl} alt={upload.file.name} className="w-full h-28 object-cover" />
                      <div className="p-2 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-700 line-clamp-2 break-all">{upload.file.name}</p>
                        <button
                          type="button"
                          onClick={() => onRemoveQueued(upload.id)}
                          disabled={isLoading}
                          className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-red-100 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
