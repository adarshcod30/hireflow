import { createScreeningHandler, decodeKey } from '../src/screening/handler';
import { PermanentError, type Analyser } from '../src/screening/analysis';
import { APP_ID, fakeApi, PDF_BYTES, s3Event, sqsEvent } from './helpers';

const KEY = `resumes/${APP_ID}/resume.pdf`;
const CONTEXT = {
  applicationId: APP_ID,
  alreadyScreened: false,
  job: { title: 'Engineer', description: 'Build.', requiredSkills: ['sql'] },
};
const RESULT = { fitScore: 80, summary: 'Good', skills: ['sql'] };

function setup(opts: { context?: unknown; analyser?: Analyser; object?: { bytes: Uint8Array; size: number } } = {}) {
  const { api, calls } = fakeApi({
    [`GET /v1/internal/applications/${APP_ID}/screening-context`]: opts.context ?? CONTEXT,
    [`POST /v1/internal/applications/${APP_ID}/screening`]: { ok: true },
  });
  const analyser: Analyser = opts.analyser ?? { analyse: jest.fn().mockResolvedValue(RESULT) };
  const readObject = jest.fn().mockResolvedValue(opts.object ?? { bytes: PDF_BYTES, size: PDF_BYTES.length });
  const log = jest.fn();
  const handler = createScreeningHandler({ api, analyser, readObject, log });
  const posted = () => calls.filter((c) => c.method === 'POST').map((c) => c.body);
  return { handler, calls, analyser, readObject, log, posted };
}

describe('decodeKey', () => {
  it.each([
    ['resumes/abc/resume.pdf', 'resumes/abc/resume.pdf'],
    ['resumes/a+b/resume.pdf', 'resumes/a b/resume.pdf'],
    ['resumes/a%2Bb/resume.pdf', 'resumes/a+b/resume.pdf'],
    ['resumes/caf%C3%A9/resume.pdf', 'resumes/café/resume.pdf'],
  ])('%s becomes %s', (given, expected) => {
    expect(decodeKey(given)).toBe(expected);
  });
});

describe('screening handler', () => {
  it('reads the resume, scores it and posts the result to the API', async () => {
    const t = setup();
    const out = await t.handler(sqsEvent(s3Event(KEY)));

    expect(out.batchItemFailures).toEqual([]);
    expect(t.readObject).toHaveBeenCalledWith('hireflow-resumes', KEY);
    expect(t.analyser.analyse).toHaveBeenCalledWith(PDF_BYTES, CONTEXT.job);
    expect(t.posted()).toEqual([{ outcome: 'done', ...RESULT }]);
  });

  it('screens every record in a message', async () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const { api, calls } = fakeApi({
      [`GET /v1/internal/applications/${APP_ID}/screening-context`]: CONTEXT,
      [`GET /v1/internal/applications/${other}/screening-context`]: CONTEXT,
      [`POST /v1/internal/applications/${APP_ID}/screening`]: {},
      [`POST /v1/internal/applications/${other}/screening`]: {},
    });
    const handler = createScreeningHandler({
      api,
      analyser: { analyse: jest.fn().mockResolvedValue(RESULT) },
      readObject: jest.fn().mockResolvedValue({ bytes: PDF_BYTES, size: 10 }),
      log: jest.fn(),
    });
    await handler(sqsEvent(s3Event(KEY, `resumes/${other}/resume.pdf`)));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('decodes the key S3 sends before looking at it', async () => {
    const t = setup();
    await t.handler(sqsEvent(s3Event(KEY.replace('resumes/', 'resumes%2F'))));
    expect(t.readObject).toHaveBeenCalledWith('hireflow-resumes', KEY);
  });

  it('ignores the test event S3 sends when the notification is configured', async () => {
    const t = setup();
    expect((await t.handler(sqsEvent({ Event: 's3:TestEvent' }))).batchItemFailures).toEqual([]);
    expect(t.calls).toHaveLength(0);
  });

  it.each([
    ['a key outside the resumes folder', 'uploads/evil.pdf'],
    ['a key that is not an application id', 'resumes/not-a-uuid/resume.pdf'],
    ['a different file name', `resumes/${APP_ID}/other.pdf`],
    ['a path trying to escape', `resumes/${APP_ID}/../x/resume.pdf`],
  ])('ignores %s without calling anything', async (_label, key) => {
    const t = setup();
    expect((await t.handler(sqsEvent(s3Event(key)))).batchItemFailures).toEqual([]);
    expect(t.calls).toHaveLength(0);
    expect(t.readObject).not.toHaveBeenCalled();
  });

  it('drops a resume for an unknown application instead of retrying it forever', async () => {
    const { api } = fakeApi({}); // every route answers 404
    const handler = createScreeningHandler({
      api,
      analyser: { analyse: jest.fn() },
      readObject: jest.fn(),
      log: jest.fn(),
    });
    expect((await handler(sqsEvent(s3Event(KEY)))).batchItemFailures).toEqual([]);
  });

  it('does the work only once when SQS redelivers a message', async () => {
    const t = setup({ context: { ...CONTEXT, alreadyScreened: true } });
    await t.handler(sqsEvent(s3Event(KEY)));
    expect(t.readObject).not.toHaveBeenCalled();
    expect(t.posted()).toEqual([]);
  });

  describe('permanent problems with the file are reported as a failed screening, not retried', () => {
    it.each([
      [
        'a file that is not a PDF',
        { bytes: new Uint8Array(Buffer.from('<html>not a pdf</html>')), size: 20 },
        /not a PDF/,
      ],
      ['a file over 5 MB', { bytes: PDF_BYTES, size: 6 * 1024 * 1024 }, /larger than 5 MB/],
    ])('%s', async (_label, object, reason) => {
      const t = setup({ object });
      const out = await t.handler(sqsEvent(s3Event(KEY)));
      expect(out.batchItemFailures).toEqual([]);
      expect(t.posted()).toHaveLength(1);
      expect(t.posted()[0]).toMatchObject({ outcome: 'failed', error: expect.stringMatching(reason) });
      expect(t.analyser.analyse).not.toHaveBeenCalled();
    });

    it('a document the model could not read', async () => {
      const analyser = { analyse: jest.fn().mockRejectedValue(new PermanentError('The resume could not be read')) };
      const t = setup({ analyser });
      expect((await t.handler(sqsEvent(s3Event(KEY)))).batchItemFailures).toEqual([]);
      expect(t.posted()[0]).toEqual({ outcome: 'failed', error: 'The resume could not be read' });
    });
  });

  describe('temporary problems are retried through SQS, per message', () => {
    it('reports only the failing message so the others are not redelivered', async () => {
      const analyser = {
        analyse: jest
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error('slow down'), { name: 'ThrottlingException' }))
          .mockResolvedValue(RESULT),
      };
      const t = setup({ analyser });
      const out = await t.handler(sqsEvent(s3Event(KEY), s3Event(KEY)));
      expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
      expect(t.posted()).toHaveLength(1);
    });

    it('when the API is down', async () => {
      const api = {
        get: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT')),
        post: jest.fn(),
        delete: jest.fn(),
      };
      const handler = createScreeningHandler({
        api,
        analyser: { analyse: jest.fn() },
        readObject: jest.fn(),
        log: jest.fn(),
      });
      expect((await handler(sqsEvent(s3Event(KEY)))).batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
    });

    it('when the S3 read fails', async () => {
      const t = setup();
      t.readObject.mockRejectedValue(new Error('NoSuchKey'));
      expect((await t.handler(sqsEvent(s3Event(KEY)))).batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
    });
  });

  it('drops a message that is not JSON rather than sending it round the retry loop', async () => {
    const t = setup();
    expect((await t.handler(sqsEvent('this is not json'))).batchItemFailures).toEqual([]);
    expect(t.log).toHaveBeenCalledWith('error', expect.stringContaining('not JSON'), expect.anything());
  });
});
