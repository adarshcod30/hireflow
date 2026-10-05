import { createTestApp, TestApp } from './helpers/app';
import { apply, createJob, createUser } from './helpers/factories';
import { OutboxService } from '../src/outbox/outbox.service';

describe('outbox relay', () => {
  let t: TestApp;
  let relay: OutboxService;

  beforeAll(async () => {
    t = await createTestApp({ outboxBatchSize: 5 });
    relay = t.app.get(OutboxService);
  });
  beforeEach(() => {
    t.queue.sent.length = 0;
    t.queue.failIds.clear();
  });
  afterEach(async () => {
    await t.db.query(
      'TRUNCATE notification_claims, outbox, application_events, applications, candidates, jobs, users CASCADE',
    );
  });
  afterAll(() => t.close());

  async function queueMessages(count: number): Promise<void> {
    const user = await createUser(t, 'recruiter');
    const jobId = await createJob(t, user.id);
    for (let i = 0; i < count; i += 1) await apply(t, jobId, `c${i}@example.com`);
  }
  const unpublished = async (): Promise<number> =>
    (await t.db.query('SELECT 1 FROM outbox WHERE published_at IS NULL')).length;

  it('does nothing when there is nothing to send', async () => {
    expect(await relay.relayOnce()).toBe(0);
    expect(t.queue.sent).toHaveLength(0);
  });

  it('sends unpublished rows in order, marks them published, and sends nothing twice', async () => {
    await queueMessages(3);

    expect(await relay.relayOnce()).toBe(3);
    expect(t.queue.sent).toHaveLength(3);
    const ids = t.queue.sent.map((m) => BigInt(m.id));
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : 1)));
    expect(JSON.parse(t.queue.sent[0].body)).toMatchObject({
      topic: 'application.submitted',
      payload: { candidateEmail: 'c0@example.com' },
    });
    expect(await unpublished()).toBe(0);

    expect(await relay.relayOnce()).toBe(0);
    expect(t.queue.sent).toHaveLength(3);
  });

  it('works through a backlog one batch at a time', async () => {
    await queueMessages(12);
    expect(await relay.relayOnce()).toBe(5);
    expect(await relay.relayOnce()).toBe(5);
    expect(await relay.relayOnce()).toBe(2);
    expect(await relay.relayOnce()).toBe(0);
    expect(t.queue.sent).toHaveLength(12);
  });

  it('keeps a message the queue rejected and retries it on the next run', async () => {
    await queueMessages(3);
    const [, second] = await t.db.query('SELECT id FROM outbox ORDER BY id');
    t.queue.failIds.add(second.id);

    expect(await relay.relayOnce()).toBe(2);
    expect(await unpublished()).toBe(1);
    const [failed] = await t.db.query('SELECT attempts, last_error FROM outbox WHERE published_at IS NULL');
    expect(failed).toEqual({
      attempts: 1,
      last_error: 'queue rejected the message',
    });

    t.queue.failIds.clear();
    expect(await relay.relayOnce()).toBe(1);
    expect(await unpublished()).toBe(0);
    expect(t.queue.sent).toHaveLength(3);
  });

  it('does not lose or duplicate messages when two relays run at the same moment', async () => {
    await queueMessages(20);
    const results = await Promise.all([relay.relayOnce(), relay.relayOnce(), relay.relayOnce(), relay.relayOnce()]);

    // FOR UPDATE SKIP LOCKED: each relay takes different rows instead of waiting or double-sending
    expect(results.reduce((a, b) => a + b, 0)).toBe(20);
    expect(new Set(t.queue.sent.map((m) => m.id)).size).toBe(20);
    expect(await unpublished()).toBe(0);
  });

  it('does not publish a message whose transaction rolled back', async () => {
    const user = await createUser(t, 'recruiter');
    const jobId = await createJob(t, user.id);
    await expect(
      t.db.transaction(async (manager) => {
        await relay.enqueue(manager, 'application.submitted', {
          applicationId: 'x',
        });
        throw new Error('the business change failed');
      }),
    ).rejects.toThrow();
    void jobId;

    expect(await relay.relayOnce()).toBe(0);
    expect(await t.db.query('SELECT 1 FROM outbox')).toHaveLength(0);
  });

  it('the scheduled job stays idle unless the relay is switched on', async () => {
    await queueMessages(2);
    await relay.scheduledRelay(); // OUTBOX_RELAY_ENABLED is false in tests
    expect(t.queue.sent).toHaveLength(0);
  });
});
