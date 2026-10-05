import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DEFAULT_LIMIT, decodeCursor, Page, toPage } from '../common/pagination';
import { updateReturning } from '../common/sql';
import { ApplicationStatus, ScreeningStatus } from '../database/entities';
import { OutboxService, TOPIC_STATUS_CHANGED } from '../outbox/outbox.service';
import { STORAGE } from '../storage/storage.port';
import type { StoragePort, UploadTicket } from '../storage/storage.port';
import { ApplyDto, TransitionDto } from './applications.dto';
import { allowedNext, canMove, NOTIFIABLE } from './status-machine';

export const TOPIC_SUBMITTED = 'application.submitted';

export interface ApplicationRow {
  id: string;
  status: ApplicationStatus;
  version: number;
  screeningStatus: ScreeningStatus;
  fitScore: number | null;
  hasResume: boolean;
  candidateName: string;
  candidateEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplyResult {
  application: { id: string; status: ApplicationStatus };
  created: boolean;
  /** Only present on the first apply. A repeat apply must not hand out an upload ticket. */
  applicationToken?: string;
  resumeUpload?: UploadTicket;
}

const APPLICATION_TOKEN_TTL = '2h';

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly outbox: OutboxService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  /**
   * Public apply. Idempotent: the (job, candidate) unique constraint decides, so
   * a double click or a retry returns the existing application instead of
   * failing or duplicating it. Only the FIRST call receives an upload ticket,
   * otherwise anyone who knew a candidate's email could replace their resume.
   */
  async apply(jobId: string, dto: ApplyDto): Promise<ApplyResult> {
    const outcome = await this.db.transaction(async (manager) => {
      const [job] = await manager.query<{ id: string; title: string }[]>(
        `SELECT id, title FROM jobs WHERE id = $1 AND status = 'open'`,
        [jobId],
      );
      if (!job) throw new NotFoundException('Job not found or not accepting applications');

      // The no-op update makes RETURNING work on conflict without touching the stored name
      const [candidate] = await manager.query<{ id: string }[]>(
        `INSERT INTO candidates (email, full_name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [dto.email, dto.fullName],
      );

      const inserted = await manager.query<ApplyResult['application'][]>(
        `INSERT INTO applications (job_id, candidate_id) VALUES ($1, $2)
         ON CONFLICT (job_id, candidate_id) DO NOTHING
         RETURNING id, status`,
        [jobId, candidate.id],
      );

      if (inserted.length === 0) {
        const [existing] = await manager.query<ApplyResult['application'][]>(
          `SELECT id, status FROM applications WHERE job_id = $1 AND candidate_id = $2`,
          [jobId, candidate.id],
        );
        return {
          application: existing,
          created: false,
        };
      }

      const application = inserted[0];
      await manager.query(
        `INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, NULL, 'applied', 'Applied')`,
        [application.id],
      );
      await this.outbox.enqueue(manager, TOPIC_SUBMITTED, {
        applicationId: application.id,
        candidateEmail: dto.email,
        candidateName: dto.fullName,
        jobTitle: job.title,
      });
      return { application, created: true };
    });

    if (!outcome.created) return outcome;

    const [applicationToken, resumeUpload] = await Promise.all([
      this.jwt.signAsync({ sub: outcome.application.id, typ: 'application' }, { expiresIn: APPLICATION_TOKEN_TTL }),
      this.storage.createResumeUploadTicket(outcome.application.id),
    ]);
    return { ...outcome, applicationToken, resumeUpload };
  }

  /** A candidate asks for a fresh upload ticket, proving who they are with the token from apply. */
  async reissueUploadTicket(applicationId: string, token: string | undefined): Promise<UploadTicket> {
    let subject: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string }>(token ?? '', { algorithms: ['HS256'] });
      if (payload.typ !== 'application') throw new Error('wrong token type');
      subject = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired application token');
    }
    if (subject !== applicationId) throw new UnauthorizedException('Invalid or expired application token');

    const [row] = await this.db.query<{ status: string }[]>(`SELECT status FROM applications WHERE id = $1`, [
      applicationId,
    ]);
    if (!row) throw new NotFoundException('Application not found');
    return this.storage.createResumeUploadTicket(applicationId);
  }

  async listForJob(
    jobId: string,
    options: { status?: ApplicationStatus; cursor?: string; limit?: number },
  ): Promise<Page<ApplicationRow>> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(options.cursor);

    const params: unknown[] = [jobId];
    const where = ['a.job_id = $1'];
    if (options.status) {
      params.push(options.status);
      where.push(`a.status = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      where.push(`(a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(limit + 1);

    const rows = await this.db.query<Record<string, unknown>[]>(
      `SELECT a.id, a.status, a.version, a.screening_status, a.fit_score, a.resume_key IS NOT NULL AS has_resume,
              a.created_at, a.updated_at, c.full_name, c.email
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length}`,
      params,
    );
    const page = toPage(
      rows.map((r) => ({ ...this.toRow(r) })),
      limit,
    );
    return page;
  }

  async get(id: string) {
    const [row] = await this.db.query<Record<string, unknown>[]>(
      `SELECT a.*, a.resume_key IS NOT NULL AS has_resume, c.full_name, c.email, j.title AS job_title, j.id AS job_id_ref
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN jobs j ON j.id = a.job_id
       WHERE a.id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Application not found');

    const events = await this.db.query<Record<string, unknown>[]>(
      `SELECT e.id, e.from_status, e.to_status, e.note, e.created_at, u.full_name AS actor_name
       FROM application_events e
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.application_id = $1
       ORDER BY e.id`,
      [id],
    );

    return {
      ...this.toRow(row),
      jobId: row.job_id as string,
      jobTitle: row.job_title as string,
      screeningSummary: row.screening_summary as string | null,
      extractedSkills: row.extracted_skills as string[],
      screenedAt: row.screened_at as Date | null,
      allowedNext: allowedNext(row.status as ApplicationStatus),
      history: events.map((e) => ({
        id: e.id as string,
        from: e.from_status as ApplicationStatus | null,
        to: e.to_status as ApplicationStatus,
        note: e.note as string | null,
        by: e.actor_name as string | null,
        at: e.created_at as Date,
      })),
    };
  }

  /**
   * Move an application along the pipeline.
   *
   * Two safeguards: the state machine decides whether the move is legal, and the
   * UPDATE only succeeds if `version` still matches what the recruiter saw
   * (optimistic locking), so two recruiters cannot silently overwrite each other.
   * The history row and the notification message are written in the same
   * transaction, so none of the three can exist without the others.
   */
  async transition(id: string, actorId: string, dto: TransitionDto) {
    await this.db.transaction(async (manager) => {
      const [current] = await manager.query<
        { status: ApplicationStatus; version: number; email: string; full_name: string; title: string }[]
      >(
        `SELECT a.status, a.version, c.email, c.full_name, j.title
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
         WHERE a.id = $1`,
        [id],
      );
      if (!current) throw new NotFoundException('Application not found');

      const from = current.status;
      if (!canMove(from, dto.to)) {
        throw new ConflictException({
          message: `Cannot move an application from ${from} to ${dto.to}`,
          allowedNext: allowedNext(from),
        });
      }

      const updated = await updateReturning(
        manager,
        `UPDATE applications
         SET status = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $3
         RETURNING id`,
        [id, dto.to, dto.version],
      );
      if (updated.length === 0) {
        throw new ConflictException('This application was changed by someone else. Reload and try again.');
      }

      await manager.query(
        `INSERT INTO application_events (application_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $3, $4, $5)`,
        [id, from, dto.to, actorId, dto.note ?? null],
      );

      if (NOTIFIABLE.has(dto.to)) {
        await this.outbox.enqueue(manager, TOPIC_STATUS_CHANGED, {
          applicationId: id,
          candidateEmail: current.email,
          candidateName: current.full_name,
          jobTitle: current.title,
          from,
          to: dto.to,
        });
      }
    });
    return this.get(id);
  }

  async resumeDownloadUrl(id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const [row] = await this.db.query<{ resume_key: string | null }[]>(
      `SELECT resume_key FROM applications WHERE id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Application not found');
    if (!row.resume_key) throw new NotFoundException('No resume has been uploaded for this application');
    return {
      url: await this.storage.createResumeDownloadUrl(row.resume_key),
      expiresInSeconds: 300,
    };
  }

  private toRow(r: Record<string, unknown>): ApplicationRow {
    return {
      id: r.id as string,
      status: r.status as ApplicationStatus,
      version: r.version as number,
      screeningStatus: r.screening_status as ScreeningStatus,
      fitScore: (r.fit_score as number | null) ?? null,
      hasResume: Boolean(r.has_resume),
      candidateName: r.full_name as string,
      candidateEmail: r.email as string,
      createdAt: r.created_at as Date,
      updatedAt: r.updated_at as Date,
    };
  }
}
