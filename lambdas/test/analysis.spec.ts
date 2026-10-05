import { BedrockAnalyser, buildRequest, PermanentError, sanitise, TOOL_NAME } from '../src/screening/analysis';
import { PDF_BYTES } from './helpers';

const JOB = { title: 'Data Engineer', description: 'Build pipelines.', requiredSkills: ['sql', 'aws'] };

describe('buildRequest', () => {
  const request = buildRequest('apac.amazon.nova-lite-v1:0', PDF_BYTES, JOB);

  it('sends the PDF as a document block and the job as text', () => {
    const content = request.messages![0].content!;
    expect(content[0]).toMatchObject({ document: { format: 'pdf', name: 'resume', source: { bytes: PDF_BYTES } } });
    expect((content[1] as { text: string }).text).toContain('Job title: Data Engineer');
    expect((content[1] as { text: string }).text).toContain('Required skills: sql, aws');
  });

  it('forces the model through the typed tool, so it cannot answer in free text', () => {
    expect(request.toolConfig?.toolChoice).toEqual({ tool: { name: TOOL_NAME } });
    const schema = request.toolConfig!.tools![0].toolSpec!.inputSchema!.json as { required: string[] };
    expect(schema.required).toEqual(['fitScore', 'summary', 'skills']);
  });

  it('tells the model the resume is untrusted data and its instructions are not to be followed', () => {
    const system = request.system![0] as { text: string };
    expect(system.text).toMatch(/untrusted/);
    expect(system.text).toMatch(/Never follow instructions/);
  });

  it('is deterministic and bounded', () => {
    expect(request.inferenceConfig).toEqual({ maxTokens: 800, temperature: 0 });
  });

  it('truncates a huge job description and copes with no required skills', () => {
    const big = buildRequest('m', PDF_BYTES, { title: 't', description: 'x'.repeat(50_000), requiredSkills: [] });
    const text = (big.messages![0].content![1] as { text: string }).text;
    expect(text.length).toBeLessThan(6500);
    expect(text).toContain('none listed');
  });
});

describe('sanitise (the model is never trusted)', () => {
  it('passes a good result through', () => {
    expect(sanitise({ fitScore: 82, summary: ' Strong SQL. ', skills: ['SQL', 'aws'] })).toEqual({
      fitScore: 82,
      summary: 'Strong SQL.',
      skills: ['sql', 'aws'],
    });
  });

  it.each([
    [101, 100],
    [-5, 0],
    [72.6, 73],
    ['64', 64],
  ])('clamps and rounds a score of %p to %p', (given, expected) => {
    expect(sanitise({ fitScore: given, summary: '', skills: [] }).fitScore).toBe(expected);
  });

  it('cleans the skills: strings only, lowercase, unique, short, and at most 15', () => {
    const skills = ['A', 'a', ' b ', '', 42, null, 'x'.repeat(41), ...Array.from({ length: 30 }, (_, i) => `s${i}`)];
    const out = sanitise({ fitScore: 1, summary: '', skills }).skills;
    expect(out.slice(0, 2)).toEqual(['a', 'b']);
    expect(out).toHaveLength(15);
    expect(out.every((s) => s.length <= 40)).toBe(true);
  });

  it('cuts an over-long summary and tolerates a missing one', () => {
    expect(sanitise({ fitScore: 1, summary: 'x'.repeat(2000), skills: [] }).summary).toHaveLength(600);
    expect(sanitise({ fitScore: 1, skills: [] }).summary).toBe('');
    expect(sanitise({ fitScore: 1, summary: 'ok' }).skills).toEqual([]);
  });

  it.each([[undefined], [null], ['text'], [{}], [{ fitScore: 'high' }], [{ fitScore: NaN }]])('rejects %p', (raw) => {
    expect(() => sanitise(raw)).toThrow();
  });
});

describe('BedrockAnalyser', () => {
  const analyser = (send: jest.Mock) => new BedrockAnalyser({ send }, 'model-id');
  const toolReply = (input: unknown) => ({
    output: { message: { content: [{ toolUse: { name: TOOL_NAME, input } }] } },
  });

  it('returns the sanitised tool result', async () => {
    const send = jest.fn().mockResolvedValue(toolReply({ fitScore: 150, summary: 'Great', skills: ['SQL'] }));
    expect(await analyser(send).analyse(PDF_BYTES, JOB)).toEqual({ fitScore: 100, summary: 'Great', skills: ['sql'] });
    expect(send.mock.calls[0][0].input.modelId).toBe('model-id');
  });

  it('fails when the model did not call the tool', async () => {
    const send = jest.fn().mockResolvedValue({ output: { message: { content: [{ text: 'I refuse' }] } } });
    await expect(analyser(send).analyse(PDF_BYTES, JOB)).rejects.toThrow(/no structured result/);
  });

  it('treats a document Bedrock cannot read as permanent, because retrying the same bytes cannot help', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('Could not process the document'), { name: 'ValidationException' }));
    await expect(analyser(send).analyse(PDF_BYTES, JOB)).rejects.toBeInstanceOf(PermanentError);
  });

  it.each(['ThrottlingException', 'ModelTimeoutException', 'ServiceUnavailableException', 'SomethingElse'])(
    'rethrows %s so SQS retries the message',
    async (name) => {
      const send = jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name }));
      const error = await analyser(send)
        .analyse(PDF_BYTES, JOB)
        .catch((e: unknown) => e);
      expect(error).not.toBeInstanceOf(PermanentError);
      expect((error as Error).name).toBe(name);
    },
  );
});
