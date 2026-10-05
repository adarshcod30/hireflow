import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { updateReturning } from '../common/sql';
import { resumeKeyFor } from '../storage/storage.port';
import { ScreeningResultDto } from './internal.dto';

@Injectable()
export class InternalService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * The screening worker asks what it needs to know. The upload landing in S3 is
   * what triggers it, so this is also the moment the API learns a resume exists.
   * Safe to call again if the queue redelivers the message.
   */
  async beginScreening(applicationId: string) {
    const rows = await updateReturning(
      this.db,
      `UPDATE applications a
       SET resume_key = $2,
           resume_uploaded_at = COALESCE(a.resume_uploaded_at, now()),
           screening_status = CASE WHEN a.screening_status = 'done' THEN 'done' ELSE 'processing' END,
           updated_at = now()
       FROM jobs j
       WHERE a.id = $1 AND j.id = a.job_id
       RETURNING a.id, a.screening_status, j.title, j.description, j.required_skills`,
      [applicationId, resumeKeyFor(applicationId)],
    );
    if (rows.length === 0) throw new NotFoundException('Application not found');
    const row = rows[0];
    return {
      applicationId: row.id as string,
      resumeKey: resumeKeyFor(applicationId),
      alreadyScreened: row.screening_status === 'done',
      job: {
        title: row.title as string,
        description: row.description as string,
        requiredSkills: row.required_skills as string[],
      },
    };
  }

  async recordScreening(applicationId: string, dto: ScreeningResultDto) {
    if (dto.outcome === 'done' && dto.fitScore === undefined) {
      throw new BadRequestException('fitScore is required when outcome is done');
    }
    const rows =
      dto.outcome === 'done'
        ? await updateReturning(
            this.db,
            `UPDATE applications
             SET screening_status = 'done', fit_score = $2, screening_summary = $3, extracted_skills = $4::text[],
                 screened_at = now(), updated_at = now()
             WHERE id = $1 RETURNING id`,
            [applicationId, dto.fitScore, dto.summary ?? null, dto.skills ?? []],
          )
        : await updateReturning(
            this.db,
            `UPDATE applications
             SET screening_status = 'failed', screening_summary = $2, screened_at = now(), updated_at = now()
             WHERE id = $1 AND screening_status <> 'done' RETURNING id`,
            [applicationId, dto.error ?? dto.summary ?? 'Screening failed'],
          );
    // A failure arriving after a success is ignored rather than undoing the good result
    if (rows.length === 0 && dto.outcome === 'done') throw new NotFoundException('Application not found');
    return { ok: true };
  }

  async staleApplications(days: number) {
    const rows = await this.db.query<Record<string, unknown>[]>(
      `SELECT a.id, a.status, j.title, c.full_name,
              floor(extract(epoch FROM (now() - a.updated_at)) / 86400)::int AS days_idle
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN candidates c ON c.id = a.candidate_id
       WHERE a.status IN ('applied', 'screening', 'interview', 'offer')
         AND a.updated_at < now() - make_interval(days => $1)
       ORDER BY a.updated_at ASC
       LIMIT 50`,
      [days],
    );
    const [{ total }] = await this.db.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM applications
       WHERE status IN ('applied', 'screening', 'interview', 'offer') AND updated_at < now() - make_interval(days => $1)`,
      [days],
    );
    return {
      days,
      total: total,
      items: rows.map((r) => ({
        id: r.id as string,
        status: r.status as string,
        jobTitle: r.title as string,
        candidateName: r.full_name as string,
        daysIdle: r.days_idle as number,
      })),
    };
  }

  /** Take responsibility for sending one notification. Exactly one caller gets `claimed: true`. */
  async claim(outboxId: string) {
    const rows = await this.db
      .query<{ outbox_id: string }[]>(
        `INSERT INTO notification_claims (outbox_id) VALUES ($1)
         ON CONFLICT (outbox_id) DO NOTHING RETURNING outbox_id`,
        [outboxId],
      )
      .catch((error: { code?: string }): { outbox_id: string }[] => {
        // The outbox row is gone: nothing to send
        if (error.code === '23503') return [];
        throw error;
      });
    return { claimed: rows.length > 0 };
  }

  /** Give the claim back after a failed send so the redelivered message can try again. */
  async release(outboxId: string): Promise<void> {
    await this.db.query(`DELETE FROM notification_claims WHERE outbox_id = $1`, [outboxId]);
  }
}
