import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const outputPath = path.join(repoRoot, 'src', 'generated', 'changelogSummary.ts');

const DEFAULT_MODEL = 'gpt-4.1-mini';
let envLoaded = false;

function parseEnvLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) return null;
  const equalsIndex = line.indexOf('=');
  if (equalsIndex <= 0) return null;
  const key = line.slice(0, equalsIndex).trim();
  if (!key) return null;
  let value = line.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

async function loadEnvFiles() {
  if (envLoaded) return;
  envLoaded = true;
  const envFiles = ['.env', '.env.local'];
  for (const fileName of envFiles) {
    const envPath = path.join(repoRoot, fileName);
    let raw = '';
    try {
      raw = await readFile(envPath, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (process.env[parsed.key] == null || process.env[parsed.key] === '') {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}

function parseDeveloperChangelog(markdown) {
  const lines = markdown.split(/\r?\n/);
  const releases = [];
  let currentRelease = null;
  let currentSection = null;

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
      currentRelease = { date: line.slice(3).trim(), sections: [] };
      continue;
    }

    if (line.startsWith('### ')) {
      pushSection();
      currentSection = { title: line.slice(4).trim(), items: [] };
      continue;
    }

    if (line.startsWith('- ')) {
      if (!currentRelease) continue;
      if (!currentSection) currentSection = { title: '', items: [] };
      currentSection.items.push(line.slice(2).trim());
    }
  }

  pushRelease();
  return releases;
}

function describeReleaseFocus(release) {
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

function buildFriendlyTitle(release) {
  const titledSections = release.sections
    .map((section) => section.title.trim())
    .filter(Boolean);
  if (titledSections.length === 0) return 'Release highlights';
  if (titledSections.length === 1) return titledSections[0];
  return `${titledSections[0]} + ${titledSections.length - 1} more`;
}

function buildFriendlyHighlights(release) {
  return release.sections
    .flatMap((section) =>
      section.items.map((item) => (section.title ? `${section.title}: ${item}` : item)),
    )
    .slice(0, 6);
}

function buildDeterministicFriendlyReleases(releases) {
  return releases.map((release) => ({
    date: release.date,
    title: buildFriendlyTitle(release),
    summary: describeReleaseFocus(release),
    highlights: buildFriendlyHighlights(release),
    source: 'fallback',
  }));
}

function sanitizeAiReleases(aiReleases, fallbackByDate) {
  if (!Array.isArray(aiReleases)) return [];
  const safe = [];
  for (const entry of aiReleases) {
    if (!entry || typeof entry !== 'object') continue;
    const date = typeof entry.date === 'string' ? entry.date.trim() : '';
    if (!date || !fallbackByDate.has(date)) continue;
    const fallback = fallbackByDate.get(date);
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : fallback.title;
    const summary =
      typeof entry.summary === 'string' && entry.summary.trim() ? entry.summary.trim() : fallback.summary;
    const highlights = Array.isArray(entry.highlights)
      ? entry.highlights
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    safe.push({
      date,
      title,
      summary,
      highlights: highlights.length > 0 ? highlights : fallback.highlights,
      source: 'ai',
    });
  }
  return safe;
}

async function generateAiFriendlyReleases(devReleases, fallbackReleases) {
  await loadEnvFiles();
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return { releases: null, model: null, reason: 'OPENAI_API_KEY is not set' };
  }

  const model = (process.env.OPENAI_CHANGELOG_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fallbackByDate = new Map(fallbackReleases.map((release) => [release.date, release]));

  const promptPayload = devReleases.map((release) => ({
    date: release.date,
    sections: release.sections,
  }));

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You rewrite developer changelog entries for end users. Return JSON only with shape: {"releases":[{"date":"YYYY-MM-DD","title":"...","summary":"...","highlights":["..."]}]}. Use plain language, avoid jargon, and keep highlights concise.',
        },
        {
          role: 'user',
          content: `Create a layman summary for each release date below. Keep each summary to one sentence and each highlight short.\n\n${JSON.stringify(promptPayload)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status} ${response.statusText}): ${body.slice(0, 300)}`);
  }

  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('OpenAI response did not include JSON content.');
  }

  const parsed = JSON.parse(rawContent);
  const aiReleases = sanitizeAiReleases(parsed?.releases, fallbackByDate);
  if (aiReleases.length === 0) {
    throw new Error('OpenAI returned no usable release summaries.');
  }
  return { releases: aiReleases, model, reason: null };
}

function mergeReleases(fallbackReleases, aiReleases) {
  if (!aiReleases || aiReleases.length === 0) return fallbackReleases;
  const aiByDate = new Map(aiReleases.map((release) => [release.date, release]));
  return fallbackReleases.map((fallbackRelease) => aiByDate.get(fallbackRelease.date) || fallbackRelease);
}

function buildOutputModule(summary) {
  const serialized = JSON.stringify(summary, null, 2);
  return `/* AUTO-GENERATED FILE. Do not edit manually. Run npm run generate:changelog-summary. */
import type { FriendlyChangelogRelease } from '../lib/changelogSummary';

export type ChangelogSummarySource = 'ai' | 'fallback';

export type GeneratedFriendlyChangelogRelease = FriendlyChangelogRelease & {
  source: ChangelogSummarySource;
};

export type GeneratedChangelogSummary = {
  generatedAt: string;
  model: string | null;
  sourceNote: string;
  releases: GeneratedFriendlyChangelogRelease[];
};

const summary: GeneratedChangelogSummary = ${serialized};

export default summary;
`;
}

async function main() {
  const markdown = await readFile(changelogPath, 'utf8');
  const developerReleases = parseDeveloperChangelog(markdown);
  const fallbackReleases = buildDeterministicFriendlyReleases(developerReleases);

  let aiResult = { releases: null, model: null, reason: 'AI generation not attempted' };
  try {
    aiResult = await generateAiFriendlyReleases(developerReleases, fallbackReleases);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    aiResult = { releases: null, model: null, reason: message };
    process.stderr.write(`[generate:changelog-summary] ${message}\n`);
  }

  const mergedReleases = mergeReleases(fallbackReleases, aiResult.releases);
  const summary = {
    generatedAt: new Date().toISOString(),
    model: aiResult.model,
    sourceNote: aiResult.releases ? 'AI summaries generated during build.' : `Using deterministic fallback. ${aiResult.reason}`,
    releases: mergedReleases,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buildOutputModule(summary), 'utf8');

  const mode = aiResult.releases ? 'ai+fallback' : 'fallback-only';
  process.stdout.write(`[generate:changelog-summary] Wrote ${summary.releases.length} releases (${mode}).\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[generate:changelog-summary] ${message}\n`);
  process.exitCode = 1;
});
