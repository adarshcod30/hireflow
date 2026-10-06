import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Chips } from '../../components/ui';
import { EMPLOYMENT_LABEL, formatPay, shortDate, WORK_MODE_LABEL } from '../../lib/format';
import type { Job } from '../../types';

/** One role on the board. The whole card is the link, and the arrow is only a hint. */
export function JobCard({ job }: { job: Job }) {
  const pay = formatPay(job);
  return (
    <li>
      <Link to={`/jobs/${job.id}`} className="job-card">
        <span className="date">{shortDate(job.createdAt)}</span>
        <div>
          <h2>{job.title}</h2>
          <p className="team">
            {job.team} · {job.location}
          </p>
        </div>
        <div>
          <p className="label">Required skills</p>
          <Chips items={job.requiredSkills} max={3} />
        </div>
        <div className="foot">
          <div className="pay">
            {pay ?? 'Pay on request'}
            <small>
              {EMPLOYMENT_LABEL[job.employmentType]} · {WORK_MODE_LABEL[job.workMode]}
            </small>
          </div>
          <span className="round-arrow" aria-hidden="true">
            <ArrowRight size={18} />
          </span>
        </div>
      </Link>
    </li>
  );
}
