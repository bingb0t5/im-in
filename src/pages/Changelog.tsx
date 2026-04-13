import { useState } from 'react';
import changelogContent from '../../CHANGELOG.md?raw';
import generatedChangelogSummary from '../generated/changelogSummary';
import {
  buildDeterministicFriendlyReleases,
  parseDeveloperChangelog,
  type FriendlyChangelogRelease,
} from '../lib/changelogSummary';

type ChangelogView = 'friendly' | 'full';

const developerReleases = parseDeveloperChangelog(changelogContent);
const fallbackFriendlyReleases = buildDeterministicFriendlyReleases(developerReleases);
const generatedFriendlyByDate = new Map(
  generatedChangelogSummary.releases.map((release) => [release.date, release]),
);
const friendlyReleases: FriendlyChangelogRelease[] = fallbackFriendlyReleases.map(
  (fallbackRelease) => generatedFriendlyByDate.get(fallbackRelease.date) ?? fallbackRelease,
);

export default function Changelog() {
  const [view, setView] = useState<ChangelogView>('friendly');

  return (
    <main className="px-6 py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 via-brand-500 to-emerald-500 px-6 py-7 text-white shadow-[0_20px_50px_rgba(16,185,129,0.18)] sm:px-7">
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/80">What&apos;s New</p>
            <h1 className="text-3xl font-black tracking-tight sm:text-[2.1rem]">Changelog</h1>
            <p className="max-w-2xl text-sm font-medium leading-relaxed text-white/90">
              Switch between a plain-language product update view and the full technical changelog.
            </p>
          </div>
        </section>

        <section className="ui-card p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setView('friendly')}
              className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${
                view === 'friendly'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              What changed for you
            </button>
            <button
              type="button"
              onClick={() => setView('full')}
              className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${
                view === 'full'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Full changelog
            </button>
          </div>
        </section>

        {view === 'friendly' ? (
          <section className="space-y-4">
            {friendlyReleases.map((release) => (
              <article key={release.date} className="ui-card overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-6">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-600">{release.date}</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">{release.title}</h2>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">{release.summary}</p>
                </div>
                <div className="px-5 py-5 sm:px-6">
                  <ul className="space-y-3">
                    {release.highlights.map((highlight) => (
                      <li key={highlight} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                        <span className="mt-[0.42rem] h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="space-y-4">
            {developerReleases.map((release) => (
              <article key={release.date} className="ui-card px-5 py-5 sm:px-6 sm:py-6">
                <div className="space-y-5">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-600">{release.date}</p>
                    <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{release.date}</h2>
                  </div>

                  <div className="space-y-5">
                    {release.sections.map((section, sectionIndex) => (
                      <div
                        key={`${release.date}-${section.title || sectionIndex}`}
                        className={`${sectionIndex > 0 ? 'border-t border-slate-100 pt-5' : ''}`}
                      >
                        {section.title ? (
                          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">
                            {section.title}
                          </h3>
                        ) : null}
                        <ul className={`space-y-3 text-sm leading-relaxed text-slate-600 ${section.title ? 'mt-3' : ''}`}>
                          {section.items.map((item) => (
                            <li key={item} className="flex gap-3">
                              <span className="mt-[0.42rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
