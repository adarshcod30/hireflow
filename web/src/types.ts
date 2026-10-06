export type ApplicationStatus = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
export type ScreeningStatus = 'pending' | 'processing' | 'done' | 'failed';
export type JobStatus = 'draft' | 'open' | 'paused' | 'closed';
export type Role = 'admin' | 'recruiter';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship';
export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type SalaryPeriod = 'hour' | 'month' | 'year';

/** The same rules the API enforces. The server has the last word, this only decides which buttons to offer. */
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  applied: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
];

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Job {
  id: string;
  title: string;
  team: string;
  location: string;
  description: string;
  requiredSkills: string[];
  status: JobStatus;
  employmentType: EmploymentType;
  workMode: WorkMode;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

export interface ApplicationRow {
  id: string;
  status: ApplicationStatus;
  version: number;
  screeningStatus: ScreeningStatus;
  fitScore: number | null;
  hasResume: boolean;
  candidateName: string;
  candidateEmail: string;
  createdAt: string;
  updatedAt: string;
  /** Present on the cross-job candidates list. */
  jobId?: string;
  jobTitle?: string;
}

export interface HistoryEntry {
  id: string;
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  note: string | null;
  by: string | null;
  at: string;
}

export interface ApplicationDetail extends ApplicationRow {
  jobId: string;
  jobTitle: string;
  screeningSummary: string | null;
  extractedSkills: string[];
  screenedAt: string | null;
  allowedNext: ApplicationStatus[];
  history: HistoryEntry[];
}

export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
  key: string;
  maxBytes: number;
  expiresInSeconds: number;
}

export interface ApplyResult {
  application: { id: string; status: ApplicationStatus };
  created: boolean;
  applicationToken?: string;
  resumeUpload?: UploadTicket;
}

export interface PipelineJob {
  id: string;
  title: string;
  status: JobStatus;
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  avgFitScore: number | null;
}

export interface Overview {
  totals: {
    openJobs: number;
    jobs: number;
    applications: number;
    last7Days: number;
    previous7Days: number;
    screened: number;
    screeningInFlight: number;
    avgFitScore: number | null;
    stale: number;
  };
  byStatus: Record<ApplicationStatus, number>;
  daily: { date: string; count: number }[];
  scoreDistribution: { label: string; count: number }[];
  topJobs: { id: string; title: string; status: JobStatus; applications: number; avgFitScore: number | null }[];
}
