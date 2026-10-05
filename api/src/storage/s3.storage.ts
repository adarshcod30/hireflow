import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_RESUME_BYTES, resumeKeyFor, StoragePort, UploadTicket } from './storage.port';

const UPLOAD_TTL_SECONDS = 600;
const DOWNLOAD_TTL_SECONDS = 300;

export class S3Storage implements StoragePort {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createResumeUploadTicket(applicationId: string): Promise<UploadTicket> {
    const key = resumeKeyFor(applicationId);
    // A presigned POST (not PUT) because a POST policy can enforce a size limit
    // and a content type; S3 rejects the upload itself if either is wrong.
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Expires: UPLOAD_TTL_SECONDS,
      Fields: { 'Content-Type': 'application/pdf' },
      Conditions: [
        ['content-length-range', 1, MAX_RESUME_BYTES],
        ['eq', '$Content-Type', 'application/pdf'],
      ],
    });
    return {
      url,
      fields,
      key,
      maxBytes: MAX_RESUME_BYTES,
      expiresInSeconds: UPLOAD_TTL_SECONDS,
    };
  }

  createResumeDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: 'attachment',
      }),
      { expiresIn: DOWNLOAD_TTL_SECONDS },
    );
  }
}
