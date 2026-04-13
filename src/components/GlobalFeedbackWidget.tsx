import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AnimatePresence, motion } from 'motion/react';
import { MessageSquare, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { invokePublicFunction } from '../lib/functions';
import { feedbackTypeOptions, fileToDataUrl } from '../lib/feedback';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { isMainTabsRoute } from '../lib/mainTabsRoutes';
import { FeedbackSubmissionPayload, FeedbackSubmissionResult, FeedbackSubmissionType } from '../types';

const emptyFeedbackForm = {
  submissionType: 'feedback' as FeedbackSubmissionType,
  title: '',
  details: '',
  reporterName: '',
  reporterEmail: '',
};

export function GlobalFeedbackWidget({ user }: { user: User | null }) {
  const location = useLocation();
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState(emptyFeedbackForm);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);

  useBodyScrollLock(showFeedbackModal);

  useEffect(() => {
    if (!showFeedbackModal) return;
    const metadata = user?.user_metadata || {};
    const preferredName =
      metadata.full_name ||
      metadata.name ||
      metadata.preferred_name ||
      metadata.nickname ||
      '';
    setFeedbackForm((prev) => ({
      ...prev,
      reporterName: prev.reporterName || preferredName,
      reporterEmail: prev.reporterEmail || user?.email || '',
    }));
  }, [showFeedbackModal, user?.email, user?.user_metadata]);

  const shouldFloatAboveMainTabs = !!user && isMainTabsRoute(location.pathname);
  const isGuestActivityDetailRoute = /^\/events\/[^/]+\/?$/.test(location.pathname);
  const buttonBottomOffset = shouldFloatAboveMainTabs
    ? 'calc(env(safe-area-inset-bottom) + 5.2rem)'
    : 'calc(env(safe-area-inset-bottom) + 0.9rem)';
  const buttonPositionStyle = isGuestActivityDetailRoute
    ? { top: 'calc(env(safe-area-inset-top) + 4.75rem)' }
    : { bottom: buttonBottomOffset };

  const closeFeedbackModal = () => {
    if (feedbackSubmitting) return;
    setShowFeedbackModal(false);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    setFeedbackForm(emptyFeedbackForm);
    setScreenshotDataUrl(null);
    setScreenshotName(null);
  };

  const handleSubmitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedbackError(null);
    setFeedbackSuccess(null);

    const payload: FeedbackSubmissionPayload = {
      submissionType: feedbackForm.submissionType,
      title: feedbackForm.title.trim(),
      details: feedbackForm.details.trim(),
      reporterName: feedbackForm.reporterName.trim() || undefined,
      reporterEmail: feedbackForm.reporterEmail.trim().toLowerCase() || undefined,
      pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
      screenshotDataUrl: screenshotDataUrl || undefined,
      source: 'global_feedback_button',
    };

    if (payload.title.length < 3) {
      setFeedbackError('Please add a short title.');
      return;
    }
    if (payload.details.length < 8) {
      setFeedbackError('Please add a bit more detail.');
      return;
    }

    setFeedbackSubmitting(true);
    try {
      const result = await invokePublicFunction<FeedbackSubmissionResult>('submit-feedback', payload);
      if (!result?.ok) {
        throw new Error('Could not send feedback right now.');
      }

      setFeedbackSuccess(
        result.blockedByAbuse
          ? 'Thanks. Your feedback was received and is pending review.'
          : 'Thanks. Your feedback has been sent to the review board.',
      );
      setFeedbackForm(emptyFeedbackForm);
      setScreenshotDataUrl(null);
      setScreenshotName(null);
    } catch (submitError) {
      setFeedbackError(submitError instanceof Error ? submitError.message : 'Could not send feedback right now.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleScreenshotChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFeedbackError(null);

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setFeedbackError('Please upload PNG, JPG, or WEBP.');
      event.currentTarget.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFeedbackError('Screenshot is too large. Max size is 5MB.');
      event.currentTarget.value = '';
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setScreenshotDataUrl(dataUrl);
      setScreenshotName(file.name);
    } catch (readError) {
      setFeedbackError(readError instanceof Error ? readError.message : 'Could not read screenshot.');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowFeedbackModal(true)}
        className="fixed right-5 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-brand-600 bg-gradient-to-br from-teal-300 via-brand-500 to-teal-700 text-white shadow-[0_10px_24px_rgba(13,148,136,0.34)] ring-1 ring-white/70 transition-all hover:brightness-105"
        style={buttonPositionStyle}
        aria-label="Send feedback"
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {showFeedbackModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeFeedbackModal}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[2rem] bg-white text-left shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
                <div className="space-y-1">
                  <p className="ui-eyebrow">Send feedback</p>
                  <h2 className="text-xl font-black tracking-tight text-slate-900">Help shape I&apos;m In</h2>
                </div>
                <button type="button" onClick={closeFeedbackModal} className="rounded-xl p-2 transition-all hover:bg-slate-50">
                  <X className="h-6 w-6 text-slate-300" />
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto px-8 pb-8 pt-6">
                <form onSubmit={handleSubmitFeedback} className="space-y-4">
                  <div className="space-y-2">
                    <label className="ui-label">Feedback type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {feedbackTypeOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFeedbackForm((prev) => ({ ...prev, submissionType: option.value }))}
                          className={`rounded-xl border px-3 py-3 text-xs font-bold transition-all ${
                            feedbackForm.submissionType === option.value
                              ? 'border-brand-600 bg-brand-50 text-brand-700'
                              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="ui-label">Title</label>
                    <input
                      type="text"
                      value={feedbackForm.title}
                      onChange={(event) => setFeedbackForm((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder="Short summary"
                      className="ui-input"
                    />
                  </div>

                  <div>
                    <label className="ui-label">Details</label>
                    <textarea
                      value={feedbackForm.details}
                      onChange={(event) => setFeedbackForm((prev) => ({ ...prev, details: event.target.value }))}
                      placeholder="What happened, what you expected, or what you’d like to see."
                      rows={5}
                      className="ui-input min-h-[132px] resize-none py-4"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="ui-label">Your name</label>
                      <input
                        type="text"
                        value={feedbackForm.reporterName}
                        onChange={(event) => setFeedbackForm((prev) => ({ ...prev, reporterName: event.target.value }))}
                        placeholder="Optional"
                        className="ui-input"
                      />
                    </div>
                    <div>
                      <label className="ui-label">Your email</label>
                      <input
                        type="email"
                        value={feedbackForm.reporterEmail}
                        onChange={(event) => setFeedbackForm((prev) => ({ ...prev, reporterEmail: event.target.value }))}
                        placeholder="Optional"
                        className="ui-input"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="ui-label">Screenshot</label>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleScreenshotChange} className="ui-input py-3" />
                    {screenshotName ? <p className="mt-2 text-xs font-medium text-slate-500">{screenshotName}</p> : null}
                  </div>

                  {feedbackError ? <p className="ui-feedback ui-feedback-error">{feedbackError}</p> : null}
                  {feedbackSuccess ? <p className="ui-feedback ui-feedback-info">{feedbackSuccess}</p> : null}

                  <button
                    type="submit"
                    disabled={feedbackSubmitting}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand-600 bg-brand-600 px-4 text-sm font-bold text-white transition-all hover:border-brand-500 hover:bg-brand-500 disabled:opacity-60"
                  >
                    {feedbackSubmitting ? 'Sending...' : 'Send feedback'}
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
