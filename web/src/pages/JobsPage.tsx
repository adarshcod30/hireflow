import { useInfiniteQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../api';
import { ErrorNote, Skills } from '../components/badges';
import type { Job, Page } from '../types';

export function JobsPage() {
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());

  const jobs = useInfiniteQuery({
    queryKey: ['public-jobs', q],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page<Job>>(`/v1/public/jobs${query({ q, cursor: pageParam, limit: 10 })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = jobs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section>
      <h1>Open roles</h1>
      <p className="muted">Find a role, apply in a minute, and upload your resume as a PDF.</p>
      <label className="search">
        <span className="sr-only">Search roles</span>
        <input
          type="search"
          placeholder="Search by title or keyword"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <ErrorNote error={jobs.error} />
      {jobs.isPending && <p className="muted">Loading roles...</p>}
      {!jobs.isPending && items.length === 0 && <p className="empty">No open roles match that search.</p>}

      <ul className="cards">
        {items.map((job) => (
          <li key={job.id} className="card">
            <h2>
              <Link to={`/jobs/${job.id}`}>{job.title}</Link>
            </h2>
            <p className="muted">
              {job.team} · {job.location}
            </p>
            <p>{job.description.length > 180 ? `${job.description.slice(0, 180)}...` : job.description}</p>
            <Skills skills={job.requiredSkills} />
          </li>
        ))}
      </ul>

      {jobs.hasNextPage && (
        <button className="secondary" onClick={() => void jobs.fetchNextPage()} disabled={jobs.isFetchingNextPage}>
          {jobs.isFetchingNextPage ? 'Loading...' : 'Load more'}
        </button>
      )}
    </section>
  );
}
