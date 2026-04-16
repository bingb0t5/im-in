import { EventCustomJoinFieldConfig, EventCustomJoinFieldType } from '../types';

const FIELD_TYPES = new Set<EventCustomJoinFieldType>(['text', 'number', 'select']);

const normalizeLabel = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.slice(0, 120);
};

const normalizeOptions = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, 20);
};

export const normalizeCustomJoinFieldConfig = (value: unknown): EventCustomJoinFieldConfig | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type =
    typeof raw.type === 'string' && FIELD_TYPES.has(raw.type as EventCustomJoinFieldType)
      ? (raw.type as EventCustomJoinFieldType)
      : 'text';
  const label = normalizeLabel(raw.label);
  const required = raw.required === true;
  const enabled = raw.enabled === true;
  const options = type === 'select' ? normalizeOptions(raw.options) : [];

  return {
    enabled,
    type,
    label,
    required,
    options,
  };
};

export const buildCustomJoinFieldConfigForSave = (value: EventCustomJoinFieldConfig | null | undefined) => {
  const normalized = normalizeCustomJoinFieldConfig(value);
  if (!normalized || !normalized.enabled) return null;
  const trimmedLabel = normalized.label.trim();
  if (!trimmedLabel) return null;
  if (normalized.type === 'select' && (!normalized.options || normalized.options.length === 0)) {
    return null;
  }
  return {
    ...normalized,
    label: trimmedLabel,
  };
};

export const parseSelectOptionsFromText = (value: string) =>
  value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20);

export const validateCustomJoinAnswer = (
  config: EventCustomJoinFieldConfig | null | undefined,
  answer: string,
) => {
  const normalizedConfig = normalizeCustomJoinFieldConfig(config);
  const label = (normalizedConfig?.label || '').trim();
  const trimmed = answer.trim();
  if (!normalizedConfig || !normalizedConfig.enabled) {
    return { ok: true as const, normalizedAnswer: '' };
  }
  if (normalizedConfig.required && !trimmed) {
    return { ok: false as const, error: `${label || 'This field'} is required.` };
  }
  if (!trimmed) {
    return { ok: true as const, normalizedAnswer: '' };
  }
  if (normalizedConfig.type === 'number' && Number.isNaN(Number(trimmed))) {
    return { ok: false as const, error: 'Please enter a valid number.' };
  }
  if (normalizedConfig.type === 'select') {
    const options = normalizedConfig.options || [];
    const hasOption = options.some((option) => option.toLowerCase() === trimmed.toLowerCase());
    if (!hasOption) {
      return { ok: false as const, error: 'Please choose one of the listed options.' };
    }
  }
  return { ok: true as const, normalizedAnswer: trimmed };
};
