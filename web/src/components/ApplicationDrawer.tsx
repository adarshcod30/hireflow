import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { ApplicationDetail } from '../types';
import { ApplicationView } from './ApplicationView';
import { Drawer } from './overlay';

/** A side panel over the current page, so a recruiter can decide without losing their place. */
export function ApplicationDrawer({ id, onClose }: { id: string; onClose(): void }) {
  // Same key as the view inside, so this adds no request
  const app = useQuery({
    queryKey: ['application', id],
    queryFn: () => api<ApplicationDetail>(`/v1/applications/${id}`, { auth: true }),
  });
  return (
    <Drawer title={app.data?.candidateName ?? 'Application'} subtitle={app.data?.candidateEmail} onClose={onClose}>
      <ApplicationView id={id} />
    </Drawer>
  );
}
