export const STORAGE = Symbol('STORAGE');

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
  key: string;
  maxBytes: number;
  expiresInSeconds: number;
}

/** Where resumes live. S3 in production, a stand-in in development and tests. */
export interface StoragePort {
  /** A short-lived ticket the browser uses to upload a PDF directly to storage. */
  createResumeUploadTicket(applicationId: string): Promise<UploadTicket>;
  /** A short-lived link for a recruiter to download the resume. */
  createResumeDownloadUrl(key: string): Promise<string>;
}

export const resumeKeyFor = (applicationId: string): string => `resumes/${applicationId}/resume.pdf`;
