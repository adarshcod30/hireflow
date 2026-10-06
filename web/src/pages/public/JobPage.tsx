import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Briefcase, CalendarDays, CheckCircle2, FileUp, Laptop, MapPin, Users } from 'lucide-react';
import { useState, type DragEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { Chips, EmptyState, ErrorNote, Skeleton } from '../../components/ui';
import { EMPLOYMENT_LABEL, formatPay, shortDate, WORK_MODE_LABEL } from '../../lib/format';
import type { ApplyResult, Job, UploadTicket } from '../../types';
import { checkResume, uploadResume } from '../../upload';

type Step = 'form' | 'upload' | 'done' | 'already';
const STEP_INDEX: Record<Step, number> = { form: 0, upload: 1, done: 2, already: 2 };

export function JobPage() {
  const { id = '' } = useParams();
  const job = useQuery({ queryKey: ['public-job', id], queryFn: () => api<Job>(`/v1/public/jobs/${id}`), retry: false });

  if (job.isPending) {
    return (
      <div className="job-layout" aria-label="Loading role">
        <Skeleton height={420} />
        <Skeleton height={320} />
      </div>
    );
  }
  if (job.error) {
    const notFound = job.error instanceof ApiError && job.error.status === 404;
    return (
      <EmptyState title={notFound ? 'This role is no longer open' : 'Could not load this role'}>
        <Link to="/">See open roles</Link>
      </EmptyState>
    );
  }

  const j = job.data;
  const pay = formatPay(j);
  return (
    <>
      <Link to="/" className="crumb">
        <ArrowLeft size={16} aria-hidden="true" /> All roles
      </Link>
      <div className="job-layout">
        <article>
          <header className="job-head">
            <h1>{j.title}</h1>
            <div className="meta">
              <span>
                <Users size={16} aria-hidden="true" /> {j.team}
              </span>
              <span>
                <MapPin size={16} aria-hidden="true" /> {j.location}
              </span>
              <span>
                <Briefcase size={16} aria-hidden="true" /> {EMPLOYMENT_LABEL[j.employmentType]}
              </span>
              <span>
                <Laptop size={16} aria-hidden="true" /> {WORK_MODE_LABEL[j.workMode]}
              </span>
              <span>
                <CalendarDays size={16} aria-hidden="true" /> Posted {shortDate(j.createdAt)}
              </span>
            </div>
          </header>
          <div className="job-body">
            <section>
              <h2>About the role</h2>
              <p className="prose">{j.description}</p>
            </section>
            {j.requiredSkills.length > 0 && (
              <section>
                <h2>What you will need</h2>
                <Chips items={j.requiredSkills} label="Required skills" />
              </section>
            )}
          </div>
        </article>

        <aside className="apply-card" aria-label="Apply">
          {pay && (
            <div>
              <span className="muted small">
                <Banknote size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> Compensation
              </span>
              <p className="pay-big">{pay}</p>
            </div>
          )}
          <ApplyPanel jobId={j.id} jobTitle={j.title} />
        </aside>
      </div>
    </>
  );
}

function ApplyPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ticket, setTicket] = useState<UploadTicket | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);

  const apply = useMutation({
    mutationFn: () =>
      api<ApplyResult>(`/v1/public/jobs/${jobId}/applications`, { method: 'POST', body: { email, fullName } }),
    onSuccess: (res) => {
      setApplicationId(res.application.id);
      if (!res.created || !res.resumeUpload) return setStep('already');
      setTicket(res.resumeUpload);
      setToken(res.applicationToken ?? null);
      setStep('upload');
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !ticket) throw new Error('Choose a resume first.');
      await uploadResume(ticket, file);
    },
    onSuccess: () => setStep('done'),
  });

  // The upload ticket lasts ten minutes. If it has expired, ask for a fresh one with the application token.
  const refresh = useMutation({
    mutationFn: () =>
      api<{ resumeUpload: UploadTicket }>(`/v1/public/applications/${applicationId}/resume-upload-url`, {
        method: 'POST',
        headers: { 'X-Application-Token': token ?? '' },
      }),
    onSuccess: (res) => {
      setTicket(res.resumeUpload);
      upload.reset();
    },
  });

  const choose = (next: File | null) => {
    setFile(next);
    setFileError(next ? checkResume(next) : null);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files?.[0] ?? null);
  };
  const onApply = (e: FormEvent) => {
    e.preventDefault();
    apply.mutate();
  };
  const onUpload = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setFileError('Please choose your resume.');
    const problem = checkResume(file);
    if (problem) return setFileError(problem);
    setFileError(null);
    upload.mutate();
  };

  const stepper = (
    <ol className="stepper" aria-label="Application progress">
      {(['Details', 'Resume', 'Done'] as const).map((label, i) => (
        <li
          key={label}
          data-state={i < STEP_INDEX[step] ? 'done' : i === STEP_INDEX[step] ? 'current' : 'todo'}
          aria-current={i === STEP_INDEX[step] ? 'step' : undefined}
        >
          <span className="sr-only">{label}</span>
        </li>
      ))}
    </ol>
  );

  if (step === 'done') {
    return (
      <div className="stack" role="status">
        {stepper}
        <span className="success-mark">
          <CheckCircle2 size={28} />
        </span>
        <h2>Application received</h2>
        <p className="muted">
          Thank you for applying for {jobTitle}. We are reading your resume now, and you will get an email about next
          steps.
        </p>
        <Link className="btn btn-secondary btn-block" to="/">
          See more roles
        </Link>
      </div>
    );
  }

  if (step === 'already') {
    return (
      <div className="stack" role="status">
        {stepper}
        <h2>You have already applied</h2>
        <p className="muted">We have your application for {jobTitle}. We will email you when there is an update.</p>
      </div>
    );
  }

  if (step === 'upload') {
    return (
      <form className="stack" onSubmit={onUpload}>
        {stepper}
        <div>
          <h2>Upload your resume</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Your application is saved. A PDF of up to 5 MB lets us screen it.
          </p>
        </div>
        <label
          className="dropzone"
          data-active={dragging}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <FileUp size={26} aria-hidden="true" />
          <strong>{file ? file.name : 'Choose a PDF or drop it here'}</strong>
          <span className="muted small">{file ? `${(file.size / 1024).toFixed(0)} KB` : 'PDF, up to 5 MB'}</span>
          <input
            type="file"
            aria-label="Resume (PDF)"
            accept="application/pdf,.pdf"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
        </label>
        {fileError && (
          <p role="alert" className="notice notice-error">
            {fileError}
          </p>
        )}
        <ErrorNote error={upload.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={upload.isPending}>
          {upload.isPending ? 'Uploading...' : 'Upload resume'}
        </button>
        {upload.error && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            Get a fresh upload link
          </button>
        )}
        <ErrorNote error={refresh.error} />
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={onApply}>
      {stepper}
      <h2>Apply for this role</h2>
      <label className="field">
        <span>Full name</span>
        <input
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          maxLength={200}
          autoComplete="name"
        />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          autoComplete="email"
        />
      </label>
      <ErrorNote error={apply.error} />
      <button type="submit" className="btn btn-primary btn-block" disabled={apply.isPending}>
        {apply.isPending ? 'Submitting...' : 'Apply'}
      </button>
      <p className="hint">Next you will upload your resume as a PDF.</p>
    </form>
  );
}
