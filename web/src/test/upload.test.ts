import { describe, expect, it, vi } from 'vitest';
import { checkResume, MAX_RESUME_BYTES, uploadResume } from '../upload';
import { pdfFile, ticket } from './helpers';

describe('checkResume', () => {
  it('accepts a PDF', () => {
    expect(checkResume(pdfFile())).toBeNull();
  });

  it('accepts a file with a .pdf name even if the browser gives no type', () => {
    expect(checkResume(new File([new Uint8Array(10)], 'CV.PDF'))).toBeNull();
  });

  it.each([
    ['a Word document', new File([new Uint8Array(10)], 'cv.docx', { type: 'application/msword' }), /PDF/],
    ['an empty file', pdfFile('a.pdf', 0), /empty/],
    ['a file over 5 MB', pdfFile('a.pdf', MAX_RESUME_BYTES + 1), /5 MB/],
  ])('rejects %s', (_label, file, message) => {
    expect(checkResume(file)).toMatch(message);
  });

  it('allows exactly 5 MB', () => {
    expect(checkResume(pdfFile('a.pdf', MAX_RESUME_BYTES))).toBeNull();
  });
});

describe('uploadResume', () => {
  it('posts to the ticket URL with every signed field first and the file LAST, because S3 ignores fields after the file', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await uploadResume(ticket(), pdfFile());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ticket().url);
    expect(init.method).toBe('POST');
    const names = [...(init.body as FormData).keys()];
    expect(names).toEqual([...Object.keys(ticket().fields), 'file']);
    expect(names.at(-1)).toBe('file');
    expect((init.body as FormData).get('Policy')).toBe('abc');
  });

  it('shows the reason S3 gave when it refuses the upload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<Error><Code>EntityTooLarge</Code><Message>Your proposed upload exceeds the maximum allowed size</Message></Error>', { status: 400 })),
    );
    await expect(uploadResume(ticket(), pdfFile())).rejects.toThrow('Upload was refused: Your proposed upload exceeds the maximum allowed size');
  });

  it('gives a generic message when there is no reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(uploadResume(ticket(), pdfFile())).rejects.toThrow('Upload failed (503)');
  });
});
