import { MAX_RESUME_BYTES, resumeKeyFor, StoragePort, UploadTicket } from './storage.port';

/**
 * Development and test stand-in. It hands out well-formed tickets that point
 * nowhere, so the API can be exercised without AWS. Uploading a real resume
 * needs the S3 driver.
 */
export class LocalStorage implements StoragePort {
  createResumeUploadTicket(applicationId: string): Promise<UploadTicket> {
    const key = resumeKeyFor(applicationId);
    return Promise.resolve({
      url: 'http://localhost/local-storage-upload',
      fields: { key, 'Content-Type': 'application/pdf' },
      key,
      maxBytes: MAX_RESUME_BYTES,
      expiresInSeconds: 600,
    });
  }

  createResumeDownloadUrl(key: string): Promise<string> {
    return Promise.resolve(`http://localhost/local-storage/${key}`);
  }
}
