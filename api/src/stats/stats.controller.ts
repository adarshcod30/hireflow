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
}
