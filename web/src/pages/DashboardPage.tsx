import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, StatusBadge } from '../components/badges';
import type { Job, JobStatus, PipelineJob } from '../types';

const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;

export function DashboardPage() {
  const qc = useQueryClient();
  const stats = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api<{ jobs: PipelineJob[] }>('/v1/stats/pipeline', { auth: true }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      api<Job>(`/v1/jobs/${id}`, { method: 'PATCH', auth: true, body: { status } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pipeline'] }),
  });

  return (
    <section>
      <h1>Pipeline</h1>
      <ErrorNote error={stats.error ?? setStatus.error} />
      {stats.isPending && <p className="muted">Loading...</p>}
      {stats.data && stats.data.jobs.length === 0 && <p className="empty">No jobs yet. Create the first one below.</p>}

      {stats.data && stats.data.jobs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th>Total</th>
                {STAGES.map((s) => (
                  <th key={s} className="num">
                    {s}
                  </th>
                ))}
                <th className="num">Avg fit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.data.jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link to={`/recruiter/jobs/${job.id}`}>{job.title}</Link>
                  </td>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="num">{job.total}</td>
                  {STAGES.map((s) => (
                    <td key={s} className="num">
                      {job.byStatus[s]}
                    </td>
                  ))}
                  <td className="num">{job.avgFitScore ?? '-'}</td>
                  <td>
                    {job.status !== 'open' && job.status !== 'closed' && (
                      <button className="link" onClick={() => setStatus.mutate({ id: job.id, status: 'open' })}>
                        Publish
                      </button>
                    )}
                    {job.status === 'open' && (
                      <button className="link" onClick={() => setStatus.mutate({ id: job.id, status: 'closed' })}>
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewJobForm />
    </section>
  );
}

function NewJobForm() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState('');
  const [description, setDescription] = useState('');
  const [skills, setSkills] = useState('');
  const [publish, setPublish] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      api<Job>('/v1/jobs', {
        method: 'POST',
        auth: true,
        body: {
          title,
          team,
          description,
          requiredSkills: skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          status: publish ? 'open' : 'draft',
        },
      }),
    onSuccess: () => {
      setTitle('');
      setTeam('');
      setDescription('');
      setSkills('');
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h2>New job</h2>
      <div className="grid2">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} />
        </label>
        <label>
          Team
          <input value={team} onChange={(e) => setTeam(e.target.value)} required maxLength={100} />
        </label>
      </div>
      <label>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          minLength={10}
          rows={5}
        />
      </label>
      <label>
        Required skills (comma separated)
        <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="postgresql, aws, typescript" />
      </label>
      <label className="check">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish immediately
      </label>
      <ErrorNote error={create.error} />
      {create.isSuccess && (
        <p role="status" className="ok">
          Job created.
        </p>
      )}
      <button type="submit" disabled={create.isPending}>
        {create.isPending ? 'Creating...' : 'Create job'}
      </button>
    </form>
  );
}
