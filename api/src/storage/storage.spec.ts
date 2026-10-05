import { S3Client } from '@aws-sdk/client-s3';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { MAX_RESUME_BYTES, resumeKeyFor } from './storage.port';

const APP_ID = '0a1b2c3d-0000-4000-8000-0123456789ab';

// Presigning is local cryptography, so it needs credentials but never touches the network
const client = () =>
  new S3Client({
    region: 'ap-south-1',
    credentials: {
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secretexample',
    },
  });

describe('resume key', () => {
  it('is derived from the application id, so a worker can find the application from the S3 key alone', () => {
    expect(resumeKeyFor(APP_ID)).toBe(`resumes/${APP_ID}/resume.pdf`);
  });
});

describe('S3Storage', () => {
  const storage = new S3Storage(client(), 'hireflow-resumes');

  describe('upload ticket', () => {
    it('is a presigned POST for the right bucket and key', async () => {
      const ticket = await storage.createResumeUploadTicket(APP_ID);
      expect(ticket.url).toContain('hireflow-resumes');
      expect(ticket.key).toBe(resumeKeyFor(APP_ID));
      expect(ticket.fields.key).toBe(ticket.key);
      expect(ticket.expiresInSeconds).toBe(600);
      expect(ticket.maxBytes).toBe(MAX_RESUME_BYTES);
    });

    it('lets S3 itself enforce the size limit and the content type, via the signed policy', async () => {
      const { fields } = await storage.createResumeUploadTicket(APP_ID);
      const policy = JSON.parse(Buffer.from(fields.Policy, 'base64').toString('utf8')) as {
        conditions: unknown[];
        expiration: string;
      };
      expect(policy.conditions).toEqual(
        expect.arrayContaining([
          ['content-length-range', 1, MAX_RESUME_BYTES],
          ['eq', '$Content-Type', 'application/pdf'],
        ]),
      );
      expect(policy.conditions).toEqual(expect.arrayContaining([{ bucket: 'hireflow-resumes' }]));
      expect(new Date(policy.expiration).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(policy.expiration).getTime()).toBeLessThanOrEqual(Date.now() + 601_000);
    });

    it('signs the policy, so a client cannot loosen it', async () => {
      const { fields } = await storage.createResumeUploadTicket(APP_ID);
      expect(fields['X-Amz-Signature']).toMatch(/^[0-9a-f]{64}$/);
      expect(fields['Content-Type']).toBe('application/pdf');
    });

    it('gives each application its own key', async () => {
      const other = await storage.createResumeUploadTicket('ffffffff-0000-4000-8000-0123456789ab');
      expect(other.key).not.toBe(resumeKeyFor(APP_ID));
    });
  });

  describe('download link', () => {
    it('is short lived, points at the object and forces a download', async () => {
      const url = new URL(await storage.createResumeDownloadUrl(resumeKeyFor(APP_ID)));
      expect(url.pathname).toBe(`/${resumeKeyFor(APP_ID)}`);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

describe('LocalStorage', () => {
  const local = new LocalStorage();

  it('hands out a well-formed ticket and link without any AWS access', async () => {
    const ticket = await local.createResumeUploadTicket(APP_ID);
    expect(ticket).toMatchObject({
      key: resumeKeyFor(APP_ID),
      maxBytes: MAX_RESUME_BYTES,
      expiresInSeconds: 600,
    });
    expect(ticket.fields.key).toBe(ticket.key);
    expect(await local.createResumeDownloadUrl('resumes/x/resume.pdf')).toContain('resumes/x/resume.pdf');
  });
});
