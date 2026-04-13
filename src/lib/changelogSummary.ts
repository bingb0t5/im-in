export type DevChangelogSection = {
  title: string;
  items: string[];
};

export type DevChangelogRelease = {
  date: string;
  sections: DevChangelogSection[];
};

export type FriendlyChangelogRelease = {
  date: string;
  title: string;
  summary: string;
  highlights: string[];
};

const TOPIC_REPLACEMENTS: Array<[RegExp, string]> = [
  [/`[^`]+`/g, ''],
  [/\/[a-z0-9\-/:_]+/gi, ''],
  [/\b(rpc|sql|schema|migration|trigger|supabase|edge function|backend)\b/gi, 'core systems'],
  [/\bwhatsapp auth\b/gi, 'WhatsApp sign-in'],
  [/\brsvp\b/gi, 'joining'],
  [/\bui\/ux\b/gi, 'experience'],
  [/\bactivity-detail\b/gi, 'activity pages'],
  [/\bhost\b/gi, 'organizer'],
  [/\badmin\b/gi, 'management'],
  [/\s+/g, ' '],
];

function toSentenceCase(value: string): string {
  const text = value.trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function simplifyTopic(topic: string): string {
  let text = topic.trim();
  for (const [pattern, replacement] of TOPIC_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/[()]/g, '').replace(/\s{2,}/g, ' ').trim();
  text = text.replace(/[,:;.\-]+$/g, '').trim();
  if (!text) return 'the app experience';
  return toSentenceCase(text);
}

function pickSectionVerb(items: string[]): string {
  const body = items.join(' ').toLowerCase();
  if (/(fixed|fix|bug|retry|hardened|reliability|stale|error|fail)/.test(body)) {
    return 'Improved reliability for';
  }
  if (/(added|new|introduc|support|enable)/.test(body)) {
    return 'Added support for';
  }
  if (/(updated|refresh|polish|improv|clearer|easier)/.test(body)) {
    return 'Improved';
  }
  return 'Updated';
}

export function parseDeveloperChangelog(markdown: string): DevChangelogRelease[] {
  const lines = markdown.split(/\r?\n/);
  const releases: DevChangelogRelease[] = [];
  let currentRelease: DevChangelogRelease | null = null;
  let currentSection: DevChangelogSection | null = null;

  const pushSection = () => {
    if (!currentRelease || !currentSection) return;
    if (currentSection.title || currentSection.items.length > 0) {
      currentRelease.sections.push(currentSection);
    }
    currentSection = null;
  };

  const pushRelease = () => {
    if (!currentRelease) return;
    pushSection();
    if (currentRelease.sections.length > 0) {
      releases.push(currentRelease);
    }
    currentRelease = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === '# CHANGELOG') continue;

    if (line.startsWith('## ')) {
      pushRelease();
      currentRelease = {
        date: line.slice(3).trim(),
        sections: [],
      };
      continue;
    }

    if (line.startsWith('### ')) {
      pushSection();
      currentSection = {
        title: line.slice(4).trim(),
        items: [],
      };
      continue;
    }

    if (line.startsWith('- ')) {
      if (!currentRelease) continue;
      if (!currentSection) {
        currentSection = { title: '', items: [] };
      }
      currentSection.items.push(line.slice(2).trim());
    }
  }

  pushRelease();
  return releases;
}

export function describeReleaseFocus(release: DevChangelogRelease): string {
  const titledSections = release.sections
    .map((section) => section.title.trim())
    .filter(Boolean);

  if (titledSections.length === 0) {
    return 'This release focuses on polish, reliability, and easier everyday use.';
  }

  const topics = titledSections.map((title) => simplifyTopic(title.toLowerCase()));
  const lead = topics[0].toLowerCase();
  if (topics.length === 1) return `This release mainly improves ${lead}.`;
  if (topics.length === 2) return `This release improves ${lead} and ${topics[1].toLowerCase()}.`;
  return `This release improves ${lead}, ${topics[1].toLowerCase()}, and other key areas.`;
}

export function buildFriendlyTitle(release: DevChangelogRelease): string {
  const titledSections = release.sections
    .map((section) => section.title.trim())
    .filter(Boolean);

  if (titledSections.length === 0) return 'Product improvements';
  const firstTopic = simplifyTopic(titledSections[0]).replace(/[+]/g, '').trim();
  if (titledSections.length === 1) return firstTopic;
  return `${firstTopic} and more`;
}

export function buildFriendlyHighlights(release: DevChangelogRelease): string[] {
  const sectionHighlights = release.sections
    .filter((section) => section.title.trim() || section.items.length > 0)
    .map((section) => {
      const topic = simplifyTopic(section.title || 'the app experience').toLowerCase();
      const verb = pickSectionVerb(section.items);
      return `${verb} ${topic}.`;
    })
    .slice(0, 4);

  if (sectionHighlights.length > 0) {
    return sectionHighlights;
  }

  return ['Improved the app experience with clearer flows and better reliability.'];
}

export function buildDeterministicFriendlyReleases(
  releases: DevChangelogRelease[],
): FriendlyChangelogRelease[] {
  return releases.map((release) => ({
    date: release.date,
    title: buildFriendlyTitle(release),
    summary: describeReleaseFocus(release),
    highlights: buildFriendlyHighlights(release),
  }));
}
