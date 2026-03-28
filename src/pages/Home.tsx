import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronRight, Users, X, Heart, Info, ThumbsUp, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { guestService } from '../services/guestService';
import { invokePublicFunction } from '../lib/functions';
import { feedbackTypeOptions, fileToDataUrl } from '../lib/feedback';
import { FeedbackSubmissionPayload, FeedbackSubmissionResult, FeedbackSubmissionType } from '../types';

const emptyFeedbackForm = {
  submissionType: 'feedback' as FeedbackSubmissionType,
  title: '',
  details: '',
  reporterName: '',
  reporterEmail: '',
};

export default function Home({ user }: { user: User | null }) {
  const [showWhyModal, setShowWhyModal] = useState(false);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [hasGuestSession, setHasGuestSession] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState(emptyFeedbackForm);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);

  useEffect(() => {
    setHasGuestSession(!!guestService.getStoredSession());
  }, []);

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
      pageUrl: window.location.href,
      screenshotDataUrl: screenshotDataUrl || undefined,
      source: 'home_modal',
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

  const activitiesPath = user ? '/my-activities' : hasGuestSession ? '/bookings' : '/login?recovery=true';
  const activitiesLabel = user ? 'My Activities' : "Activities I'm In";

  return (
      <div className="min-h-[100svh] flex flex-col items-center justify-between px-6 pt-5 pb-4 bg-slate-50 text-center md:min-h-screen md:justify-center md:py-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full flex-1 flex flex-col justify-center items-center"
        >
          <div className="inline-flex items-center justify-center w-20 h-20 bg-brand-600 rounded-3xl mb-5 shadow-xl shadow-brand-600/10">
            <CalendarIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 mb-1.5">I'm In</h1>
          <p className="text-lg text-slate-500 mb-6 font-medium">
            See what's on. Say I'm in.
          </p>
          
          <div className="w-full space-y-5">
            <div className="space-y-3.5">
              <Link 
                to="/create-event" 
                className="block w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                Create an Activity
                <ChevronRight className="w-5 h-5" />
              </Link>

              <Link 
                to="/calendar" 
                className="block w-full bg-white hover:bg-slate-50 text-slate-900 font-black py-4 rounded-2xl border border-slate-100 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                What's On
                <CalendarIcon className="w-5 h-5 text-brand-600" />
              </Link>

              <Link 
                to={activitiesPath}
                className="block w-full bg-brand-50 hover:bg-brand-100 text-brand-600 font-black py-4 rounded-2xl border border-brand-100 shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                {activitiesLabel}
                <ThumbsUp className="w-5 h-5" />
              </Link>
              
              <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
                <button 
                  onClick={() => setShowWhyModal(true)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                >
                  <Info className="w-3.5 h-3.5" />
                  Why this exists
                </button>
                <button 
                  onClick={() => setShowBuildModal(true)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                >
                  <Heart className="w-3.5 h-3.5" />
                  Help build it
                </button>
                <button 
                  onClick={() => setShowHowItWorksModal(true)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5" />
                  How this works
                </button>
                <button
                  onClick={() => setShowFeedbackModal(true)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Send feedback
                </button>
                <Link
                  to="/moderation"
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-widest transition-colors"
                >
                  Moderation transparency
                </Link>
              </div>
            </div>

            <div className="pt-2">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                Built for real communities.<br />Kept simple on purpose.
              </p>
            </div>
          </div>
        </motion.div>
        
        <footer className="mt-4 text-slate-300 text-[9px] font-bold tracking-[0.18em] flex items-center gap-2 uppercase">
          A community project, started by Lalo
        </footer>

        {/* Feedback Modal */}
        <AnimatePresence>
          {showFeedbackModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left overflow-y-auto overscroll-contain">
              <motion.div
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
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[85vh] sm:max-h-[80vh] my-auto"
              >
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Share feedback</h2>
                  <button onClick={closeFeedbackModal} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>

                <form className="space-y-3.5" onSubmit={handleSubmitFeedback}>
                  <label className="block">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</span>
                    <select
                      value={feedbackForm.submissionType}
                      onChange={(e) =>
                        setFeedbackForm((prev) => ({ ...prev, submissionType: e.target.value as FeedbackSubmissionType }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    >
                      {feedbackTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Title</span>
                    <input
                      value={feedbackForm.title}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="Short summary"
                      className="mt-1 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Details</span>
                    <textarea
                      value={feedbackForm.details}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, details: e.target.value }))}
                      placeholder="What happened, what you expected, and any extra context."
                      rows={4}
                      className="mt-1 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Screenshot (optional)</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleScreenshotChange}
                      className="mt-1 block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-600 hover:file:bg-slate-200"
                    />
                    {screenshotName ? <p className="mt-1 text-[11px] text-slate-400">Attached: {screenshotName}</p> : null}
                  </label>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Name (optional)</span>
                      <input
                        value={feedbackForm.reporterName}
                        onChange={(e) => setFeedbackForm((prev) => ({ ...prev, reporterName: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email (optional)</span>
                      <input
                        type="email"
                        value={feedbackForm.reporterEmail}
                        onChange={(e) => setFeedbackForm((prev) => ({ ...prev, reporterEmail: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      />
                    </label>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Reports are screened for abuse and may create a sanitized Trello review card. Sensitive details stay in the app review
                    pipeline.
                  </p>

                  {feedbackError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{feedbackError}</div>
                  ) : null}
                  {feedbackSuccess ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                      {feedbackSuccess}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={feedbackSubmitting}
                    className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-3.5 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {feedbackSubmitting ? 'Sending...' : 'Send feedback'}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Why this exists Modal */}
        <AnimatePresence>
          {showWhyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left overflow-y-auto overscroll-contain">
              <motion.div 
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
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Why I'm In exists</h2>
                  <button onClick={() => setShowWhyModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>
                
                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is a simple way to organise real-life plans, activities, and events without replacing the WhatsApp groups people already use.</p>
                  <p>You still share and chat in your groups. I’m In just makes it easier to see what&apos;s on, manage who&apos;s coming, and keep things organised.</p>
                  <p>It works alongside the groups and communities people already use, not inside a new one. In places like Hoi An, there are often overlapping groups with similar people and activities, but not always much visibility between them.</p>
                  <p>I’m In is meant to make things easier to share, discover, and join across those groups while still keeping things grounded in the communities people are already part of.</p>
                  <p className="text-slate-900 font-semibold">Build a longer table, not a higher fence.</p>
                  <p>Keep it useful. Keep it open. Keep it simple.</p>

                  <div className="pt-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">What it's for</h3>
                    <ul className="space-y-2">
                      {['classes and activities', 'sports and games', 'casual meetups', 'recurring community activities'].map((item, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-brand-600 rounded-full" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-4 space-y-3">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Built in the open</h3>
                    <p>You can see what&apos;s being worked on, what&apos;s coming next, and suggest ideas as it evolves.</p>
                    <p>The code is public. Contributions are welcome.</p>
                    <p>Ideas are welcome. We keep things simple on purpose.</p>
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <a
                    href="mailto:hello@joinimin.com"
                    className="block w-full text-center bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                  >
                    Suggest an idea
                  </a>
                  <a
                    href="https://trello.com/b/kauEWnAe/im-in-dev-board"
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    See what&apos;s being worked on
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Help build it Modal */}
        <AnimatePresence>
          {showBuildModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left overflow-y-auto overscroll-contain">
              <motion.div 
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
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Help build I'm In</h2>
                  <button onClick={() => setShowBuildModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>
                
                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is still early, and evolving as people use it.</p>
                  <p>The aim is simple: make organising things easier for real-world communities.</p>
                  <p>It&apos;s being shaped by the people who organise and join activities, not just built in isolation.</p>
                  <p>Lalo helped start the project and contributes time to it, alongside others who want to help.</p>
                  <p>If you want to help, there are lots of ways to get involved:</p>
                  
                  <div className="pt-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Ways you can help</h3>
                    <ul className="space-y-2">
                      {[
                        'test the app and share feedback',
                        'help organise or run activities',
                        'contribute design, copy, or code',
                        'suggest ideas and vote on what would be most useful'
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-brand-600 rounded-full" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p>You don’t need to be technical — just interested in making it better.</p>
                </div>

                <div className="mt-8 space-y-3">
                  <button
                    onClick={() => {
                      window.location.href = `mailto:hello@joinimin.com?subject=Helping build I'm In`;
                    }}
                    className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                  >
                    Get involved
                  </button>
                  <a
                    href="https://trello.com/b/kauEWnAe/im-in-dev-board"
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    See what&apos;s being worked on
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* How this works Modal */}
        <AnimatePresence>
          {showHowItWorksModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left overflow-y-auto overscroll-contain">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowHowItWorksModal(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh] my-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">How this works</h2>
                  <button onClick={() => setShowHowItWorksModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>

                <div className="space-y-4 text-slate-600 text-sm font-medium leading-relaxed">
                  <p>I’m In is built to be simple, useful, and shaped by the people who use it.</p>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It&apos;s open</p>
                    <p>The code is public. People can see how it works and suggest improvements.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It&apos;s shaped by the community</p>
                    <p>Ideas, feedback, and real-world use help guide what gets built next.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It stays simple on purpose</p>
                    <p>Not every idea will be added. Keeping it easy to use matters more than adding everything.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">Hosts run their own activities</p>
                    <p>Activities should be created by the person actually organising or hosting them, so it&apos;s clear who&apos;s running things.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It&apos;s maintained by people giving their time</p>
                    <p>Lalo helps build and maintain it, alongside others who choose to get involved.</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-slate-900 font-semibold">It should become more community-guided over time</p>
                    <p>As more people use it and contribute, the aim is for direction to be shaped more by the community itself.</p>
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <a
                    href="https://trello.com/b/kauEWnAe/im-in-dev-board"
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-600/10 transition-all active:scale-95"
                  >
                    See what&apos;s being worked on
                  </a>
                  <a
                    href="mailto:hello@joinimin.com"
                    className="block w-full text-center bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    Suggest an idea
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
  );
}
