import { Link, Navigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { ArrowLeft, Image, MessageSquare, Shield, SlidersHorizontal } from 'lucide-react';
import { canAccessAnyAdminFrontend, canAccessFeedbackAdminFrontend, canAccessModerationAdminFrontend } from '../lib/admin';

export default function AdminHome({ user }: { user: User | null }) {
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const canModerate = canAccessModerationAdminFrontend(user.email);
  const canReviewFeedback = canAccessFeedbackAdminFrontend(user.email);

  if (!canAccessAnyAdminFrontend(user.email)) {
    return <Navigate to="/" replace />;
  }

  const tools = [
    canModerate
      ? {
          to: '/admin/moderation',
          icon: Shield,
          title: 'Moderation',
          description: 'Review public-facing activity moderation, overrides, and queue state.',
        }
      : null,
    canModerate
      ? {
          to: '/admin/moderation/settings',
          icon: SlidersHorizontal,
          title: 'Moderation settings',
          description: 'Adjust strictness, trust thresholds, and moderation rules at runtime.',
        }
      : null,
    canModerate
      ? {
          to: '/admin/gallery',
          icon: Image,
          title: 'Gallery review',
          description: 'Review public-preview gallery images, reports, and image moderation state.',
        }
      : null,
    canReviewFeedback
      ? {
          to: '/admin/feedback',
          icon: MessageSquare,
          title: 'Feedback',
          description: 'Review internal feedback submissions, blocked items, failed Trello syncs, and retries.',
        }
      : null,
  ].filter(Boolean) as Array<{
    to: string;
    icon: typeof Shield;
    title: string;
    description: string;
  }>;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Admin</h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Hidden admin tooling</span>
          </div>
          <div className="w-9" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-6 space-y-5">
        <section className="bg-white rounded-2xl p-5">
          <p className="text-sm font-bold text-slate-900">Admin hub</p>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            Use this page as the single entry point for hidden admin tools. Any new `/admin/*` feature should be linked from here.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.to}
                to={tool.to}
                className="bg-white rounded-2xl p-5 hover:bg-slate-50 transition-colors border border-slate-100"
              >
                <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-slate-600" />
                </div>
                <p className="text-base font-bold text-slate-900 mt-4">{tool.title}</p>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">{tool.description}</p>
              </Link>
            );
          })}
        </section>
      </main>
    </div>
  );
}
