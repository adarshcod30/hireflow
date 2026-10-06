import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, SearchX } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { api, query } from '../../api';
import { EmptyState, ErrorNote, Skeleton } from '../../components/ui';
import { EMPLOYMENT_LABEL, WORK_MODE_LABEL } from '../../lib/format';
import type { EmploymentType, Job, Page, WorkMode } from '../../types';
import { JobCard } from './JobCard';

const MODES = Object.keys(WORK_MODE_LABEL) as WorkMode[];
const TYPES = ['full_time', 'contract', 'internship'] as EmploymentType[];

function FilterGroup<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: T[];
  labels: Record<T, string>;
  value: T | '';
  onChange(next: T | ''): void;
}) {
  return (
    <div className="filters" role="group" aria-label={label}>
      <button className="filter" aria-pressed={value === ''} onClick={() => onChange('')}>
        All
      </button>
      {options.map((o) => (
        <button key={o} className="filter" aria-pressed={value === o} onClick={() => onChange(value === o ? '' : o)}>
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

export function OpportunitiesPage() {
  const [search, setSearch] = useState('');
  const [workMode, setWorkMode] = useState<WorkMode | ''>('');
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>('');
  const q = useDeferredValue(search.trim());

  const jobs = useInfiniteQuery({
    queryKey: ['public-jobs', q, workMode, employmentType],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page<Job>>(`/v1/public/jobs${query({ q, workMode, employmentType, cursor: pageParam, limit: 12 })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = jobs.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = q !== '' || workMode !== '' || employmentType !== '';

  return (
    <>
      <section className="pub-hero" aria-labelledby="opps-title">
        <span className="pill">
          <span className="live" aria-hidden="true" /> Now hiring across engineering, data and design
        </span>
        <h1 id="opps-title">Opportunities</h1>
        <p>Find a role that fits, apply in a minute, and upload your resume as a PDF. A person reads every application.</p>

        <div className="search-glow">
          <label className="input-wrap">
            <span className="sr-only">Search roles</span>
            <Search size={20} aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Search by role, skill or team"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <FilterGroup label="Work mode" options={MODES} labels={WORK_MODE_LABEL} value={workMode} onChange={setWorkMode} />
        <FilterGroup
          label="Employment type"
          options={TYPES}
          labels={EMPLOYMENT_LABEL}
          value={employmentType}
          onChange={setEmploymentType}
        />
      </section>

      <ErrorNote error={jobs.error} />

      {jobs.isPending ? (
        <div className="pub-grid" aria-label="Loading roles">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={250} />
          ))}
        </div>
      ) : (
        <>
          <p className="result-count" role="status">
            {items.length === 0 ? 'No roles found' : `${items.length}${jobs.hasNextPage ? '+' : ''} ${items.length === 1 ? 'role' : 'roles'} found`}
          </p>
          {items.length === 0 ? (
            <EmptyState icon={<SearchX size={32} />} title={filtered ? 'No open roles match that search' : 'No open roles right now'}>
              {filtered ? 'Try fewer filters or a different keyword.' : 'Check back soon.'}
            </EmptyState>
          ) : (
            <ul className="pub-grid">
              {items.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </ul>
          )}
        </>
      )}

      {jobs.hasNextPage && (
        <div className="pub-more">
          <button className="btn btn-secondary" onClick={() => void jobs.fetchNextPage()} disabled={jobs.isFetchingNextPage}>
            {jobs.isFetchingNextPage ? 'Loading...' : 'Load more roles'}
          </button>
        </div>
      )}
    </>
  );
}
