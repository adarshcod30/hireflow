import { createDigestHandler } from '../src/digest/handler';
import { fakeApi } from './helpers';

const REPORT = {
  days: 7,
  total: 3,
  items: [
    { id: 'a', status: 'applied', jobTitle: 'Engineer', candidateName: 'Asha <b>Rao</b>', daysIdle: 12 },
    { id: 'b', status: 'interview', jobTitle: 'Designer', candidateName: 'Ben', daysIdle: 9 },
  ],
};

function setup(report: unknown) {
  const { api, calls } = fakeApi({ 'GET /v1/internal/reports/stale-applications?days=7': report });
  const sendEmail = jest.fn().mockResolvedValue(undefined);
  const emit = jest.fn();
  const handler = createDigestHandler({ api, sendEmail, to: 'team@example.com', days: 7, log: jest.fn(), emit });
  return { handler, calls, sendEmail, emit };
}

describe('digest handler', () => {
  it('emails a list when applications are waiting, and publishes the count as a metric', async () => {
    const t = setup(REPORT);
    expect(await t.handler()).toEqual({ total: 3, emailed: true });

    const mail = t.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string; html: string };
    expect(mail.to).toBe('team@example.com');
    expect(mail.subject).toBe('HireFlow digest: 3 applications waiting');
    expect(mail.text).toContain('Ben for Designer: interview, untouched for 9 days');
    expect(mail.text).toContain('...and 1 more');
    expect(JSON.parse(t.emit.mock.calls[0][0] as string).StaleApplications).toBe(3);
  });

  it('escapes candidate names in the HTML part', async () => {
    const t = setup(REPORT);
    await t.handler();
    const html = (t.sendEmail.mock.calls[0][0] as { html: string }).html;
    expect(html).not.toContain('<b>Rao</b>');
    expect(html).toContain('Asha &lt;b&gt;Rao&lt;/b&gt;');
  });

  it('sends nothing when nothing is waiting, but still publishes a zero so the graph has no gaps', async () => {
    const t = setup({ days: 7, total: 0, items: [] });
    expect(await t.handler()).toEqual({ total: 0, emailed: false });
    expect(t.sendEmail).not.toHaveBeenCalled();
    expect(JSON.parse(t.emit.mock.calls[0][0] as string).StaleApplications).toBe(0);
  });

  it('does not say "and more" when every item is listed', async () => {
    const t = setup({ ...REPORT, total: 2 });
    await t.handler();
    expect((t.sendEmail.mock.calls[0][0] as { text: string }).text).not.toContain('...and');
  });
});
