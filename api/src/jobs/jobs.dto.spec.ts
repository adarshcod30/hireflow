import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobDto, JobListQuery } from './jobs.dto';

const base = {
  title: 'Backend Engineer',
  team: 'Core',
  description: 'A description that is long enough.',
};

describe('job DTOs', () => {
  it('normalises skills: trimmed, lowercase, unique, and without blanks', async () => {
    const dto = plainToInstance(CreateJobDto, {
      ...base,
      requiredSkills: [' PostgreSQL ', 'AWS', 'aws', '', '  '],
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.requiredSkills).toEqual(['postgresql', 'aws']);
  });

  it('converts paging query strings to numbers and bounds them', async () => {
    const ok = plainToInstance(JobListQuery, { limit: '25', status: 'open' });
    expect(await validate(ok)).toEqual([]);
    expect(ok.limit).toBe(25);
    for (const limit of ['0', '101', 'x']) {
      expect((await validate(plainToInstance(JobListQuery, { limit }))).length).toBeGreaterThan(0);
    }
  });

  it('rejects a skill over 50 characters and more than 30 skills', async () => {
    expect(
      (
        await validate(
          plainToInstance(CreateJobDto, {
            ...base,
            requiredSkills: ['x'.repeat(51)],
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
    const many = Array.from({ length: 31 }, (_, i) => `s${i}`);
    expect((await validate(plainToInstance(CreateJobDto, { ...base, requiredSkills: many }))).length).toBeGreaterThan(
      0,
    );
  });
});
