import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { EMPLOYMENT_LABEL, WORK_MODE_LABEL } from '../lib/format';
import type { EmploymentType, Job, JobStatus, SalaryPeriod, WorkMode } from '../types';
import { Modal } from './overlay';
import { ErrorNote } from './ui';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];
const PERIOD_LABEL: Record<SalaryPeriod, string> = { hour: 'per hour', month: 'per month', year: 'per year' };

/** Create a job, or edit one. The same form serves both, since a job has the same fields either way. */
export function JobFormModal({ job, onClose }: { job?: Job; onClose(): void }) {
  const qc = useQueryClient();
  const editing = Boolean(job);

  const [title, setTitle] = useState(job?.title ?? '');
  const [team, setTeam] = useState(job?.team ?? '');
  const [location, setLocation] = useState(job?.location ?? 'Remote');
  const [description, setDescription] = useState(job?.description ?? '');
  const [skills, setSkills] = useState(job?.requiredSkills.join(', ') ?? '');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(job?.employmentType ?? 'full_time');
  const [workMode, setWorkMode] = useState<WorkMode>(job?.workMode ?? 'remote');
  const [salaryMin, setSalaryMin] = useState(job?.salaryMin?.toString() ?? '');
  const [salaryMax, setSalaryMax] = useState(job?.salaryMax?.toString() ?? '');
  const [salaryCurrency, setSalaryCurrency] = useState(job?.salaryCurrency ?? 'USD');
  const [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod>(job?.salaryPeriod ?? 'year');
  const [status, setStatus] = useState<JobStatus>(job?.status ?? 'open');
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        team,
        location,
        description,
        requiredSkills: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        employmentType,
        workMode,
        ...(salaryMin ? { salaryMin: Number(salaryMin) } : {}),
        ...(salaryMax ? { salaryMax: Number(salaryMax) } : {}),
        salaryCurrency,
        salaryPeriod,
        status,
      };
      return editing
        ? api<Job>(`/v1/jobs/${job!.id}`, { method: 'PATCH', auth: true, body })
        : api<Job>('/v1/jobs', { method: 'POST', auth: true, body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['jobs-all'] });
      void qc.invalidateQueries({ queryKey: ['job'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (salaryMin && salaryMax && Number(salaryMax) < Number(salaryMin)) {
      return setLocalError('The maximum pay must be at least the minimum.');
    }
    setLocalError(null);
    save.mutate();
  };

  return (
    <Modal
      title={editing ? 'Edit job' : 'New job'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="job-form" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : editing ? 'Save changes' : 'Create job'}
          </button>
        </>
      }
    >
      <form id="job-form" className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            <span>Title</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} />
          </label>
          <label className="field">
            <span>Team</span>
            <input className="input" value={team} onChange={(e) => setTeam(e.target.value)} required maxLength={100} />
          </label>
        </div>
        <div className="grid-3">
          <label className="field">
            <span>Location</span>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} />
          </label>
          <label className="field">
            <span>Employment type</span>
            <select className="select" value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
              {Object.entries(EMPLOYMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Work mode</span>
            <select className="select" value={workMode} onChange={(e) => setWorkMode(e.target.value as WorkMode)}>
              {Object.entries(WORK_MODE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <label className="field">
            <span>Minimum pay</span>
            <input className="input" type="number" min={0} value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
          </label>
          <label className="field">
            <span>Maximum pay</span>
            <input className="input" type="number" min={0} value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} />
          </label>
          <label className="field">
            <span>Currency</span>
            <select className="select" value={salaryCurrency} onChange={(e) => setSalaryCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Paid</span>
            <select className="select" value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value as SalaryPeriod)}>
              {Object.entries(PERIOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} rows={5} />
        </label>
        <label className="field">
          <span>Required skills (comma separated)</span>
          <input className="input" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="postgresql, aws, typescript" />
        </label>
        {editing ? (
          <label className="field">
            <span>Status</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as JobStatus)}>
              {(['draft', 'open', 'paused', 'closed'] as JobStatus[]).map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="check">
            <input type="checkbox" checked={status === 'open'} onChange={(e) => setStatus(e.target.checked ? 'open' : 'draft')} /> Publish immediately
          </label>
        )}
        {localError && (
          <p role="alert" className="notice notice-error">
            {localError}
          </p>
        )}
        <ErrorNote error={save.error} />
      </form>
    </Modal>
  );
}
