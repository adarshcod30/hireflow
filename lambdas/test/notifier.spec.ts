import { createNotifierHandler, SesMailer, type Mailer } from '../src/notifier/handler';
import { escapeHtml, oneLine, renderEmail } from '../src/notifier/templates';
import { fakeApi, sqsEvent } from './helpers';

const MESSAGE = (over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  outboxId: '7',
  topic: 'application.status_changed',
  payload: {
    candidateEmail: 'asha@example.com',
    candidateName: 'Asha Rao',
    jobTitle: 'Platform Engineer',
    from: 'applied',
    to: 'interview',
    ...payload,
  },
  ...over,
});

function setup(opts: { claimed?: boolean; send?: jest.Mock; redirectTo?: string } = {}) {
  const { api, calls } = fakeApi({
    'POST /v1/internal/notifications/claim': { claimed: opts.claimed ?? true },
    'DELETE /v1/internal/notifications/claim/7': undefined,
  });
  // fakeApi treats undefined as "no route", so give DELETE an explicit value
  const apiWithDelete = { ...api, delete: jest.fn().mockResolvedValue(undefined) };
  const send = opts.send ?? jest.fn().mockResolvedValue(undefined);
  const mailer: Mailer = { send };
  const log = jest.fn();
  const handler = createNotifierHandler({
    api: apiWithDelete,
    mailer,
    from: 'hireflow@example.com',
    redirectTo: opts.redirectTo,
    log,
  });
  return { handler, send, calls, deleteClaim: apiWithDelete.delete, log };
}

describe('email templates', () => {
  it.each([
    ['application.submitted', {}, /received your application for Platform Engineer/],
    ['application.status_changed', { to: 'interview' }, /Next step.*Platform Engineer/],
    ['application.status_changed', { to: 'offer' }, /An offer for Platform Engineer/],
    ['application.status_changed', { to: 'hired' }, /Welcome aboard, Asha Rao/],
    ['application.status_changed', { to: 'rejected' }, /Your application for Platform Engineer/],
  ])('%s %j has a fitting subject', (topic, extra, subject) => {
    const email = renderEmail(topic, { candidateName: 'Asha Rao', jobTitle: 'Platform Engineer', ...extra });
    expect(email?.subject).toMatch(subject);
    expect(email?.text).toContain('Asha Rao');
    expect(email?.html).toContain('<p>');
  });

  it.each([
    ['a move the candidate does not hear about', 'application.status_changed', { to: 'screening' }],
    ['a withdrawal', 'application.status_changed', { to: 'withdrawn' }],
    ['an unknown topic', 'something.else', {}],
  ])('sends nothing for %s', (_label, topic, extra) => {
    expect(renderEmail(topic, extra)).toBeNull();
  });

  it('cannot be used to inject markup: names and titles are escaped', () => {
    const email = renderEmail('application.submitted', {
      candidateName: '<script>alert(1)</script>',
      jobTitle: 'Dev & "Ops" <b>',
    })!;
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('Dev &amp; &quot;Ops&quot; &lt;b&gt;');
  });

  it('cannot be used to inject headers: line breaks in a name never reach the subject', () => {
    const email = renderEmail('application.status_changed', {
      to: 'hired',
      candidateName: 'Asha\r\nBcc: attacker@example.com',
      jobTitle: 'Role',
    })!;
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).toContain('Asha Bcc: attacker@example.com');
  });

  it('copes with a payload that is missing fields', () => {
    expect(renderEmail('application.submitted', {})?.text).toContain('Hi there');
  });

  it('has working escape helpers', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(oneLine('a\r\nb c')).toBe('a b c');
  });
});

describe('notifier handler', () => {
  it('claims the message, then sends the email', async () => {
    const t = setup();
    const out = await t.handler(sqsEvent(MESSAGE()));

    expect(out.batchItemFailures).toEqual([]);
    expect(t.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/internal/notifications/claim',
      body: { outboxId: '7' },
    });
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0][0]).toMatchObject({ from: 'hireflow@example.com', to: 'asha@example.com' });
  });

  it('sends nothing when another delivery already claimed the message (effectively-once)', async () => {
    const t = setup({ claimed: false });
    expect((await t.handler(sqsEvent(MESSAGE()))).batchItemFailures).toEqual([]);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('does not even claim a message it has no email for', async () => {
    const t = setup();
    await t.handler(sqsEvent(MESSAGE({}, { to: 'screening' })));
    expect(t.calls).toHaveLength(0);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('ignores a message with no recipient', async () => {
    const t = setup();
    await t.handler(sqsEvent(MESSAGE({}, { candidateEmail: undefined })));
    expect(t.send).not.toHaveBeenCalled();
  });

  it('releases the claim and asks SQS to retry when sending fails temporarily', async () => {
    const t = setup({
      send: jest.fn().mockRejectedValue(Object.assign(new Error('Throttled'), { name: 'TooManyRequestsException' })),
    });
    const out = await t.handler(sqsEvent(MESSAGE()));
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
    expect(t.deleteClaim).toHaveBeenCalledWith('/v1/internal/notifications/claim/7');
  });

  it('keeps the claim and does not retry when SES refuses the email for good', async () => {
    const t = setup({
      send: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('Email address is not verified'), { name: 'MessageRejected' })),
    });
    const out = await t.handler(sqsEvent(MESSAGE()));
    expect(out.batchItemFailures).toEqual([]);
    expect(t.deleteClaim).not.toHaveBeenCalled();
  });

  it('retries when the claim call itself fails', async () => {
    const api = { get: jest.fn(), post: jest.fn().mockRejectedValue(new Error('API down')), delete: jest.fn() };
    const handler = createNotifierHandler({ api, mailer: { send: jest.fn() }, from: 'f@x.co', log: jest.fn() });
    expect((await handler(sqsEvent(MESSAGE()))).batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('in sandbox mode sends everything to one verified address and says who it was meant for', async () => {
    const t = setup({ redirectTo: 'me@example.com' });
    await t.handler(sqsEvent(MESSAGE()));
    const sent = t.send.mock.calls[0][0] as { to: string; subject: string };
    expect(sent.to).toBe('me@example.com');
    expect(sent.subject).toMatch(/^\[to asha@example\.com\] /);
  });

  it('keeps going after one message fails, and drops one that is not JSON', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const t = setup({ send });
    const out = await t.handler(sqsEvent(MESSAGE(), 'not json', MESSAGE({ outboxId: '7' })));
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('SesMailer', () => {
  it('builds a UTF-8 email with text and HTML parts', async () => {
    const send = jest.fn().mockResolvedValue({});
    await new SesMailer({ send } as never).send({
      from: 'f@x.co',
      to: 't@x.co',
      subject: 'Hi',
      text: 'plain',
      html: '<p>rich</p>',
    });
    expect(send.mock.calls[0][0].input).toEqual({
      FromEmailAddress: 'f@x.co',
      Destination: { ToAddresses: ['t@x.co'] },
      Content: {
        Simple: {
          Subject: { Data: 'Hi', Charset: 'UTF-8' },
          Body: { Text: { Data: 'plain', Charset: 'UTF-8' }, Html: { Data: '<p>rich</p>', Charset: 'UTF-8' } },
        },
      },
    });
  });
});
