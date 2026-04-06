import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AnimatePresence, motion } from 'motion/react';
import { Calendar as CalendarIcon, Heart, Info, MessageSquare, ThumbsUp, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { invokePublicFunction } from '../lib/functions';
import { feedbackTypeOptions, fileToDataUrl } from '../lib/feedback';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { FeedbackSubmissionPayload, FeedbackSubmissionResult, FeedbackSubmissionType } from '../types';

const DEV_BOARD_URL = 'https://trello.com/b/kauEWnAe/im-in-dev-board';

const emptyFeedbackForm = {
  submissionType: 'feedback' as FeedbackSubmissionType,
  title: '',
  details: '',
  reporterName: '',
  reporterEmail: '',
};

export function HomeCommunitySection({ user }: { user: User | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showWhyModal, setShowWhyModal] = useState(false);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState(emptyFeedbackForm);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);

  useBodyScrollLock(showWhyModal || showBuildModal || showFeedbackModal);

  useEffect(() => {
    const action = searchParams.get('action');
    if (!action) return;

    if (action === 'why') {
      setShowWhyModal(true);
    } else if (action === 'build') {
      setShowBuildModal(true);
    } else if (action === 'feedback') {
      setShowFeedbackModal(true);
    } else {
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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

  const footerBottomOffset = user
    ? 'calc(env(safe-area-inset-bottom) + 5.2rem)'
    : 'calc(env(safe-area-inset-bottom) + 0.9rem)';

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
      source: 'home_footer',
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
    <section>
      <div className="sticky z-10 px-6 text-center pointer-events-none" style={{ bottom: footerBottomOffset }}>
        <p className="text-[10px] font-bold uppercase leading-relaxed tracking-widest text-slate-400">
          Built for real communities.
          <br />
          Kept simple on purpose.
        </p>
        <footer className="pt-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-300">
          A community project, started by Lalo
        </footer>
      </div>

      {user ? (
        <button
          type="button"
          onClick={() => setShowFeedbackModal(true)}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.1rem)] right-5 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-brand-600 bg-gradient-to-br from-teal-300 via-brand-500 to-teal-700 text-white shadow-[0_10px_24px_rgba(13,148,136,0.34)] ring-1 ring-white/70 transition-all hover:brightness-105"
          aria-label="Send feedback"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      ) : null}

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

      <AnimatePresence>
        {showWhyModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWhyModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-sm flex-col overflow-hidden rounded-[2rem] bg-white text-left shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
                <h2 className="text-xl font-black tracking-tight text-slate-900">Why <span className="italic">I&apos;m In</span> exists</h2>
                <button type="button" onClick={() => setShowWhyModal(false)} className="rounded-xl p-2 transition-all hover:bg-slate-50">
                  <X className="h-6 w-6 text-slate-300" />
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto px-8 pb-8 pt-6 text-sm font-medium leading-relaxed text-slate-600">
                <div className="space-y-4">
                  <p><span className="italic">I&apos;m In</span> is a simple way to organise real-life plans, activities, and events without replacing the WhatsApp groups people already use.</p>
                  <p>You still share and chat in your groups. <span className="italic">I&apos;m In</span> just makes it easier to see what&apos;s on, manage who&apos;s coming, and keep things organised.</p>
                  <p>It works alongside the groups and communities people already use, not inside a new one.</p>
                  <p className="font-semibold text-slate-900">Build a longer table, not a higher fence.</p>
                  <p>Keep it useful. Keep it open. Keep it simple.</p>

                  <div className="pt-4">
                    <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">What it&apos;s for</h3>
                    <ul className="space-y-2">
                      {['classes and activities', 'sports and games', 'casual meetups', 'recurring community activities'].map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-brand-600" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-3 pt-4">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">How it works</h3>
                    <div className="space-y-1.5">
                      <p className="font-semibold text-slate-900">It&apos;s open</p>
                      <p>The code is public. People can see how it works and suggest improvements.</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="font-semibold text-slate-900">It&apos;s shaped by the community</p>
                      <p>Ideas, feedback, and real-world use help guide what gets built next.</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="font-semibold text-slate-900">It stays simple on purpose</p>
                      <p>Not every idea will be added. Keeping it easy to use matters more than adding everything.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <a
                    href={DEV_BOARD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full rounded-2xl bg-brand-600 py-4 text-center font-black text-white shadow-lg shadow-brand-600/10 transition-all active:scale-95 hover:bg-brand-500"
                  >
                    See what&apos;s being worked on
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setShowWhyModal(false);
                      setShowFeedbackModal(true);
                    }}
                    className="block w-full rounded-2xl bg-slate-50 py-4 text-center font-bold text-slate-600 transition-all active:scale-95 hover:bg-slate-100"
                  >
                    Send feedback
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showBuildModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowBuildModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-sm flex-col overflow-hidden rounded-[2rem] bg-white text-left shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
                <h2 className="text-xl font-black tracking-tight text-slate-900">Help build <span className="italic">I&apos;m In</span></h2>
                <button type="button" onClick={() => setShowBuildModal(false)} className="rounded-xl p-2 transition-all hover:bg-slate-50">
                  <X className="h-6 w-6 text-slate-300" />
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto px-8 pb-8 pt-6 text-sm font-medium leading-relaxed text-slate-600">
                <div className="space-y-4">
                  <p><span className="italic">I&apos;m In</span> is still early, and evolving as people use it.</p>
                  <p>The aim is simple: make organising things easier for real-world communities.</p>
                  <p>It&apos;s being shaped by the people who organise and join activities, not just built in isolation.</p>
                  <p>If you want to help, there are lots of ways to get involved:</p>

                  <div className="pt-4">
                    <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Ways you can help</h3>
                    <ul className="space-y-2">
                      {[
                        'test the app and share feedback',
                        'help organise or run activities',
                        'contribute design, copy, or code',
                        'suggest ideas and vote on what would be most useful',
                      ].map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p>You don&apos;t need to be technical — just interested in making it better.</p>
                </div>

                <div className="mt-8 space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "mailto:hello@joinimin.com?subject=Helping build I%27m In";
                    }}
                    className="w-full rounded-2xl bg-brand-600 py-4 font-black text-white shadow-lg shadow-brand-600/10 transition-all active:scale-95 hover:bg-brand-500"
                  >
                    Get involved
                  </button>
                  <a
                    href={DEV_BOARD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full rounded-2xl bg-slate-50 py-4 text-center font-bold text-slate-600 transition-all active:scale-95 hover:bg-slate-100"
                  >
                    See what&apos;s being worked on
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
      <div aria-hidden className={user ? 'h-28' : 'h-20'} />
    </section>
  );
}
