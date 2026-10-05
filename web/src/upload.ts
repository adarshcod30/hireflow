import type { UploadTicket } from './types';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export function checkResume(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Please choose a PDF file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_RESUME_BYTES) return 'The resume must be 5 MB or smaller.';
  return null;
}

/**
 * Upload straight to S3 with the presigned POST the API issued. The file never
 * passes through our server. S3 itself enforces the size limit and content type
 * from the signed policy, so a tampered request is rejected there.
 *
 * The file field MUST come last: S3 ignores any form field after it.
 */
export async function uploadResume(ticket: UploadTicket, file: File): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
  form.append('file', file);

  const res = await fetch(ticket.url, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const reason = /<Message>(.*?)<\/Message>/.exec(text)?.[1];
    throw new Error(reason ? `Upload was refused: ${reason}` : `Upload failed (${res.status})`);
  }
}
