import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Auth } from '../common/auth';

@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats')
@Auth('admin', 'recruiter')
export class StatsController {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** One aggregate query: counts per status and the average fit score, for every job. */
  @Get('pipeline')
  async pipeline() {
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT j.id, j.title, j.status,
              count(a.id)::int                                            AS total,
              count(a.id) FILTER (WHERE a.status = 'applied')::int        AS applied,
              count(a.id) FILTER (WHERE a.status = 'screening')::int      AS screening,
              count(a.id) FILTER (WHERE a.status = 'interview')::int      AS interview,
              count(a.id) FILTER (WHERE a.status = 'offer')::int          AS offer,
              count(a.id) FILTER (WHERE a.status = 'hired')::int          AS hired,
              count(a.id) FILTER (WHERE a.status = 'rejected')::int       AS rejected,
              count(a.id) FILTER (WHERE a.status = 'withdrawn')::int      AS withdrawn,
              round(avg(a.fit_score))::int                                AS avg_fit_score
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       GROUP BY j.id
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT 100`,
    );
    return {
      jobs: rows.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        status: r.status as string,
        total: r.total as number,
        byStatus: {
          applied: r.applied as number,
          screening: r.screening as number,
          interview: r.interview as number,
          offer: r.offer as number,
          hired: r.hired as number,
          rejected: r.rejected as number,
          withdrawn: r.withdrawn as number,
        },
        avgFitScore: (r.avg_fit_score as number | null) ?? null,
      })),
    };
  }

  /**
   * The numbers behind the dashboard, in four small queries run together. Dates are
   * UTC days, so a chart looks the same to everyone who opens it.
   */
  @Get('overview')
  async overview() {
    const [totals, funnel, daily, buckets, topJobs] = await Promise.all([
      this.db.query<Record<string, number | null>[]>(
        `SELECT
           (SELECT count(*)::int FROM jobs WHERE status = 'open')                             AS open_jobs,
           (SELECT count(*)::int FROM jobs)                                                    AS jobs,
           count(*)::int                                                                       AS applications,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int                AS last_7d,
           count(*) FILTER (WHERE created_at >= now() - interval '14 days'
                              AND created_at <  now() - interval '7 days')::int                AS prev_7d,
           count(*) FILTER (WHERE screening_status = 'done')::int                              AS screened,
           count(*) FILTER (WHERE screening_status IN ('pending', 'processing')
                              AND resume_key IS NOT NULL)::int                                 AS screening_in_flight,
           round(avg(fit_score))::int                                                          AS avg_fit,
           count(*) FILTER (WHERE status IN ('applied', 'screening', 'interview', 'offer')
                              AND updated_at < now() - interval '7 days')::int                 AS stale
         FROM applications`,
      ),
      this.db.query<{ status: string; n: number }[]>(
        `SELECT status, count(*)::int AS n FROM applications GROUP BY status`,
      ),
      this.db.query<{ day: string; n: number }[]>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(a.id)::int AS n
         FROM generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - interval '13 days',
                              date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') AS d
         LEFT JOIN applications a ON date_trunc('day', a.created_at AT TIME ZONE 'UTC') = d
         GROUP BY d ORDER BY d`,
      ),
      this.db.query<{ bucket: number; n: number }[]>(
        `SELECT least(fit_score / 20, 4)::int AS bucket, count(*)::int AS n
         FROM applications WHERE fit_score IS NOT NULL GROUP BY 1 ORDER BY 1`,
      ),
      this.db.query<Record<string, unknown>[]>(
        `SELECT j.id, j.title, j.status, count(a.id)::int AS applications, round(avg(a.fit_score))::int AS avg_fit
         FROM jobs j JOIN applications a ON a.job_id = j.id
         GROUP BY j.id ORDER BY count(a.id) DESC, j.created_at DESC LIMIT 5`,
      ),
    ]);

    const t = totals[0];
    const byStatus: Record<string, number> = {
      applied: 0,
      screening: 0,
      interview: 0,
      offer: 0,
      hired: 0,
      rejected: 0,
      withdrawn: 0,
    };
    for (const row of funnel) byStatus[row.status] = row.n;
    const labels = ['0-19', '20-39', '40-59', '60-79', '80-100'];
    const counts = new Map(buckets.map((b) => [b.bucket, b.n]));

    return {
      totals: {
        openJobs: t.open_jobs ?? 0,
        jobs: t.jobs ?? 0,
        applications: t.applications ?? 0,
        last7Days: t.last_7d ?? 0,
        previous7Days: t.prev_7d ?? 0,
        screened: t.screened ?? 0,
        screeningInFlight: t.screening_in_flight ?? 0,
        avgFitScore: t.avg_fit ?? null,
        stale: t.stale ?? 0,
      },
      byStatus,
      daily: daily.map((d) => ({ date: d.day, count: d.n })),
      scoreDistribution: labels.map((label, i) => ({ label, count: counts.get(i) ?? 0 })),
      topJobs: topJobs.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        status: r.status as string,
        applications: r.applications as number,
        avgFitScore: (r.avg_fit as number | null) ?? null,
      })),
    };
  }
}
