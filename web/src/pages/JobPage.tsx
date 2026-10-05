import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { ErrorNote, Skills } from '../components/badges';
import type { ApplyResult, Job, UploadTicket } from '../types';
import { checkResume, uploadResume } from '../upload';

type Step = 'form' | 'upload' | 'done' | 'already';

export function JobPage() {
  const { id = '' } = useParams();
  const job = useQuery({ queryKey: ['public-job', id], queryFn: () => api<Job>(`/v1/public/jobs/${id}`), retry: false });

  if (job.isPending) return <p className="muted">Loading...</p>;
  if (job.error) {
    const notFound = job.error instanceof ApiError && job.error.status === 404;
    return (
      <section>
        <h1>{notFound ? 'This role is no longer open' : 'Could not load this role'}</h1>
        <p>
          <Link to="/">See open roles</Link>
        </p>
      </section>
    );
  }

  return (
    <article>
      <p>
        <Link to="/">All roles</Link>
      </p>
      <h1>{job.data.title}</h1>
      <p className="muted">
        {job.data.team} · {job.data.location}
      </p>
      <Skills skills={job.data.requiredSkills} />
      <p className="prose">{job.data.description}</p>
      <ApplyPanel jobId={job.data.id} jobTitle={job.data.title} />
    </article>
  );
}

function ApplyPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
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

  if (step === 'done') {
    return (
      <div className="panel success" role="status">
        <h2>Application received</h2>
        <p>
          Thank you for applying for {jobTitle}. We are reading your resume now, and you will get an email about next
          steps.
        </p>
      </div>
    );
  }

  if (step === 'already') {
    return (
      <div className="panel" role="status">
        <h2>You have already applied</h2>
        <p>We have your application for {jobTitle}. We will email you when there is an update.</p>
      </div>
    );
  }

  if (step === 'upload') {
    return (
      <form className="panel" onSubmit={onUpload}>
        <h2>Upload your resume</h2>
        <p className="muted">Your application is saved. A PDF of up to 5 MB lets us screen it.</p>
        <label>
          Resume (PDF)
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setFileError(null);
            }}
          />
        </label>
        {fileError && (
          <p role="alert" className="error">
            {fileError}
          </p>
        )}
        <ErrorNote error={upload.error} />
        <div className="row">
          <button type="submit" disabled={upload.isPending}>
            {upload.isPending ? 'Uploading...' : 'Upload resume'}
          </button>
          {upload.error && (
            <button type="button" className="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              Get a fresh upload link
            </button>
          )}
        </div>
        <ErrorNote error={refresh.error} />
      </form>
    );
  }

  return (
    <form className="panel" onSubmit={onApply}>
      <h2>Apply for this role</h2>
      <label>
        Full name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={200} autoComplete="name" />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          autoComplete="email"
        />
      </label>
      <ErrorNote error={apply.error} />
      <button type="submit" disabled={apply.isPending}>
        {apply.isPending ? 'Submitting...' : 'Apply'}
      </button>
    </form>
  );
}
