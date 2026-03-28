import { FeedbackSubmissionType } from '../types';

export const feedbackTypeOptions: Array<{ value: FeedbackSubmissionType; label: string }> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature request' },
  { value: 'feedback', label: 'General feedback' },
];

export function getFeedbackTypeLabel(value: FeedbackSubmissionType) {
  const found = feedbackTypeOptions.find((option) => option.value === value);
  return found?.label || 'Feedback';
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}
