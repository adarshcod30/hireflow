import { SQSClient } from '@aws-sdk/client-sqs';
import { MemoryQueue } from './memory.queue';
import { SqsQueue } from './sqs.queue';

const messages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    body: `{"n":${i + 1}}`,
  }));

describe('SqsQueue', () => {
  const makeClient = (impl: (input: { Entries: { Id: string }[] }) => unknown) => {
    const send = jest.fn(async (command: { input: { Entries: { Id: string }[] } }) => impl(command.input));
    return { client: { send } as unknown as SQSClient, send };
  };

  it('sends nothing for an empty list', async () => {
    const { client, send } = makeClient(() => ({}));
    expect(await new SqsQueue(client, 'q').sendBatch([])).toEqual({
      failedIds: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('splits a large list into batches of ten, the SQS limit', async () => {
    const { client, send } = makeClient(() => ({}));
    await new SqsQueue(client, 'https://sqs/queue').sendBatch(messages(25));
    expect(send).toHaveBeenCalledTimes(3);
    const sizes = send.mock.calls.map((c) => c[0].input.Entries.length);
    expect(sizes).toEqual([10, 10, 5]);
  });

  it('uses the outbox id as the entry id and sends the body untouched', async () => {
    const { client, send } = makeClient(() => ({}));
    await new SqsQueue(client, 'https://sqs/queue').sendBatch([{ id: '42', body: '{"hello":"world"}' }]);
    const input = send.mock.calls[0][0].input as unknown as {
      QueueUrl: string;
      Entries: { Id: string; MessageBody: string }[];
    };
    expect(input.QueueUrl).toBe('https://sqs/queue');
    expect(input.Entries).toEqual([{ Id: '42', MessageBody: '{"hello":"world"}' }]);
  });

  it('reports the entries SQS rejected so only those are retried', async () => {
    const { client } = makeClient(() => ({
      Failed: [{ Id: '2' }, { Id: '4' }],
    }));
    expect(await new SqsQueue(client, 'q').sendBatch(messages(5))).toEqual({
      failedIds: ['2', '4'],
    });
  });

  it('treats a failed call as every message in that batch failing, and keeps going with the next batch', async () => {
    let call = 0;
    const { client } = makeClient(() => {
      call += 1;
      if (call === 1) throw new Error('network down');
      return {};
    });
    const result = await new SqsQueue(client, 'q').sendBatch(messages(12));
    expect(result.failedIds).toEqual(messages(10).map((m) => m.id));
  });
});

describe('MemoryQueue', () => {
  it('records what is sent and can be told to reject specific messages', async () => {
    const queue = new MemoryQueue();
    queue.failIds.add('2');
    const result = await queue.sendBatch(messages(3));
    expect(result.failedIds).toEqual(['2']);
    expect(queue.sent.map((m) => m.id)).toEqual(['1', '3']);
  });
});
