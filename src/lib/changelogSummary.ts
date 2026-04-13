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
    return 'A mix of fixes and improvements shipped in this release.';
  }

  if (titledSections.length === 1) {
    return `Focused on ${titledSections[0]}.`;
  }

  if (titledSections.length === 2) {
    return `Focused on ${titledSections[0]} and ${titledSections[1]}.`;
  }

  return `Focused on ${titledSections[0]}, ${titledSections[1]}, and ${titledSections.length - 2} more areas.`;
}

export function buildFriendlyTitle(release: DevChangelogRelease): string {
  const titledSections = release.sections
    .map((section) => section.title.trim())
    .filter(Boolean);

  if (titledSections.length === 0) return 'Release highlights';
  if (titledSections.length === 1) return titledSections[0];
  return `${titledSections[0]} + ${titledSections.length - 1} more`;
}

export function buildFriendlyHighlights(release: DevChangelogRelease): string[] {
  return release.sections
    .flatMap((section) =>
      section.items.map((item) => (section.title ? `${section.title}: ${item}` : item)),
    )
    .slice(0, 6);
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
