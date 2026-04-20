type ParsedDraft = {
  raw_title: string;
  raw_text_block: string;
  parsed_title: string;
  parsed_summary: string;
  parsed_description: string;
  parsed_activity_type: string;
  parsed_location_area: string;
  parsed_is_recurring: boolean;
  parsed_recurrence_text: string | null;
  parsed_start_datetime: string | null;
  parsed_end_datetime: string | null;
  parsed_confidence_score: number;
  review_status: 'new' | 'needs_review';
  normalization_warnings: string[];
};

const DAY_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|daily)\b/i;
const TIME_PATTERN = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/;

function classifyActivityType(text: string) {
  const t = text.toLowerCase();
  if (/(football|basketball|tennis|swim|sport|gym|yoga)/.test(t)) return 'sports';
  if (/(paint|art|music|craft|dance|creative)/.test(t)) return 'creative';
  if (/(learn|class|lesson|study|school|educat)/.test(t)) return 'educational';
  if (/(hike|beach|park|camp|outdoor)/.test(t)) return 'outdoor';
  if (/(meditation|wellbeing|wellness)/.test(t)) return 'wellbeing';
  if (/(meetup|social|community|playgroup)/.test(t)) return 'social';
  return 'other';
}

function inferLocationArea(text: string) {
  const t = text.toLowerCase();
  if (t.includes('an bang')) return 'an_bang';
  if (t.includes('cam an')) return 'cam_an';
  if (t.includes('cam ha')) return 'cam_ha';
  if (t.includes('cam chau')) return 'cam_chau';
  if (t.includes('da nang')) return 'da_nang';
  if (t.includes('hoi an')) return 'hoi_an';
  return 'other';
}

function parseDateTimeFromBlock(text: string): { start: string | null; end: string | null } {
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const timeMatch = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!dateMatch || !timeMatch) return { start: null, end: null };
  const hh = timeMatch[1].padStart(2, '0');
  const mm = timeMatch[2];
  const start = new Date(`${dateMatch[1]}T${hh}:${mm}:00`).toISOString();
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  return { start, end };
}

function summarizeBlock(block: string) {
  const clean = block.replace(/\s+/g, ' ').trim();
  return clean.length <= 160 ? clean : `${clean.slice(0, 157)}...`;
}

export function splitSourceIntoBlocks(rawText: string) {
  return rawText
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export function buildSnapshotHash(rawText: string) {
  let hash = 0;
  for (let i = 0; i < rawText.length; i += 1) {
    hash = (hash << 5) - hash + rawText.charCodeAt(i);
    hash |= 0;
  }
  return `snapshot_${Math.abs(hash)}`;
}

export function parseSourceTextToDrafts(rawText: string): ParsedDraft[] {
  const blocks = splitSourceIntoBlocks(rawText);
  return blocks.map((block) => {
    const firstLine = block.split('\n').map((line) => line.trim()).find(Boolean) || 'Community activity';
    const recurrenceMatch = block.match(DAY_PATTERN);
    const hasTime = TIME_PATTERN.test(block);
    const { start, end } = parseDateTimeFromBlock(block);
    const warnings: string[] = [];
    let confidence = 0.45;

    if (firstLine.length >= 4) confidence += 0.2;
    if (recurrenceMatch) confidence += 0.15;
    if (hasTime || start) confidence += 0.15;
    if (!recurrenceMatch && !start) warnings.push('Timing is unclear');
    if (firstLine.toLowerCase().includes('contact')) warnings.push('Title may be noisy');

    return {
      raw_title: firstLine,
      raw_text_block: block,
      parsed_title: firstLine,
      parsed_summary: summarizeBlock(block),
      parsed_description: block,
      parsed_activity_type: classifyActivityType(block),
      parsed_location_area: inferLocationArea(block),
      parsed_is_recurring: !!recurrenceMatch && !start,
      parsed_recurrence_text: recurrenceMatch ? recurrenceMatch[0] : null,
      parsed_start_datetime: start,
      parsed_end_datetime: end,
      parsed_confidence_score: Math.max(0.05, Math.min(0.98, Number(confidence.toFixed(2)))),
      review_status: confidence >= 0.7 ? 'new' : 'needs_review',
      normalization_warnings: warnings,
    };
  });
}
