import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { ApplicationView } from '../../components/ApplicationView';
import { Avatar } from '../../components/ui';
import type { ApplicationDetail } from '../../types';

/** One application on its own page, for a shared link or a bookmark. */
export function ApplicationPage() {
  const { id = '' } = useParams();
  const app = useQuery({
    queryKey: ['application', id],
    queryFn: () => api<ApplicationDetail>(`/v1/applications/${id}`, { auth: true }),
  });
  const a = app.data;

  return (
    <div style={{ maxWidth: 760 }}>
      <Link to={a ? `/recruiter/jobs/${a.jobId}` : '/recruiter/candidates'} className="crumb" style={{ marginTop: 0 }}>
        <ArrowLeft size={16} aria-hidden="true" /> {a ? `Back to ${a.jobTitle}` : 'Candidates'}
      </Link>
      {a && (
        <header className="row" style={{ gap: 16, marginBottom: 24 }}>
          <Avatar name={a.candidateName} size={56} />
          <div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 450 }}>{a.candidateName}</h1>
            <p className="muted">{a.candidateEmail}</p>
          </div>
        </header>
      )}
      <div className="stack" style={{ gap: 22 }}>
        <ApplicationView id={id} />
      </div>
    </div>
  );
}
