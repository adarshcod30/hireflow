import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_LIMIT, decodeCursor, Page, toPage } from '../common/pagination';
import { EmploymentType, JobEntity, JobStatus, SalaryPeriod, WorkMode } from '../database/entities';
import { CreateJobDto, UpdateJobDto } from './jobs.dto';

export interface JobView {
  id: string;
  title: string;
  team: string;
  location: string;
  description: string;
  requiredSkills: string[];
  status: JobStatus;
  employmentType: EmploymentType;
  workMode: WorkMode;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  createdAt: Date;
  updatedAt: Date;
}

const toView = (j: JobEntity): JobView => ({
  id: j.id,
  title: j.title,
  team: j.team,
  location: j.location,
  description: j.description,
  requiredSkills: j.requiredSkills,
  status: j.status,
  employmentType: j.employmentType,
  workMode: j.workMode,
  salaryMin: j.salaryMin,
  salaryMax: j.salaryMax,
  salaryCurrency: j.salaryCurrency,
  salaryPeriod: j.salaryPeriod,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
});

interface ListOptions {
  status?: JobStatus;
  workMode?: WorkMode;
  employmentType?: EmploymentType;
  q?: string;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class JobsService {
  constructor(@InjectRepository(JobEntity) private readonly jobs: Repository<JobEntity>) {}

  async create(userId: string, dto: CreateJobDto): Promise<JobView> {
    const job = this.jobs.create({
      title: dto.title,
      team: dto.team,
      location: dto.location ?? 'Remote',
      description: dto.description,
      requiredSkills: dto.requiredSkills ?? [],
      status: dto.status ?? 'draft',
      employmentType: dto.employmentType ?? 'full_time',
      workMode: dto.workMode ?? 'remote',
      salaryMin: dto.salaryMin ?? null,
      salaryMax: dto.salaryMax ?? null,
      salaryCurrency: dto.salaryCurrency ?? 'USD',
      salaryPeriod: dto.salaryPeriod ?? 'year',
      createdBy: userId,
    });
    this.assertSalaryRange(job.salaryMin, job.salaryMax);
    return toView(await this.jobs.save(job));
  }

  async update(id: string, dto: UpdateJobDto): Promise<JobView> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    // Only the fields that were actually sent; an absent field must never overwrite a stored value
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) (job as unknown as Record<string, unknown>)[key] = value;
    }
    this.assertSalaryRange(job.salaryMin, job.salaryMax);
    return toView(await this.jobs.save(job));
  }

  /** The database also enforces this, but a clear message beats a constraint name. */
  private assertSalaryRange(min: number | null, max: number | null): void {
    if (min !== null && max !== null && max < min) {
      throw new BadRequestException('salaryMax must be at least salaryMin');
    }
  }

  /** Recruiters see every status. */
  async listForRecruiters(options: ListOptions): Promise<Page<JobView>> {
    return this.page(options, null);
  }

  /** The public site sees open jobs only. */
  async listPublic(options: ListOptions): Promise<Page<JobView>> {
    return this.page(options, 'open');
  }

  async get(id: string): Promise<JobView> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    return toView(job);
  }

  /** A closed or draft job does not exist as far as the public is concerned. */
  async getPublic(id: string): Promise<JobView> {
    const job = await this.jobs.findOne({ where: { id, status: 'open' } });
    if (!job) throw new NotFoundException('Job not found');
    return toView(job);
  }

  private async page(options: ListOptions, forcedStatus: JobStatus | null): Promise<Page<JobView>> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(options.cursor);
    const status = forcedStatus ?? options.status;

    const qb = this.jobs.createQueryBuilder('j');
    if (status) qb.andWhere('j.status = :status', { status });
    if (options.workMode) qb.andWhere('j.workMode = :workMode', { workMode: options.workMode });
    if (options.employmentType)
      qb.andWhere('j.employmentType = :employmentType', { employmentType: options.employmentType });
    if (options.q?.trim()) {
      // websearch_to_tsquery accepts whatever a person types, quotes and minus included, and never throws
      qb.andWhere(`j.search @@ websearch_to_tsquery('english', :q)`, {
        q: options.q.trim(),
      });
    }
    if (cursor) {
      qb.andWhere('(j.createdAt, j.id) < (:ts, :id)', {
        ts: cursor.createdAt,
        id: cursor.id,
      });
    }
    const rows = await qb
      .orderBy('j.createdAt', 'DESC')
      .addOrderBy('j.id', 'DESC')
      .limit(limit + 1)
      .getMany();
    const page = toPage(rows, limit);
    return { items: page.items.map(toView), nextCursor: page.nextCursor };
  }
}
