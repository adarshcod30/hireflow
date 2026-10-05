import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type UserRole = 'admin' | 'recruiter';
export type JobStatus = 'draft' | 'open' | 'paused' | 'closed';
export type ApplicationStatus = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
export type ScreeningStatus = 'pending' | 'processing' | 'done' | 'failed';

// Timestamps are timestamptz(3): millisecond precision, so a value survives a
// round trip through a JavaScript Date and a pagination cursor exactly.
const TS = { type: 'timestamptz', precision: 3 } as const;

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'citext', unique: true }) email!: string;
  @Column({ name: 'password_hash', type: 'text' }) passwordHash!: string;
  @Column({ name: 'full_name', type: 'text' }) fullName!: string;
  @Column({
    type: 'enum',
    enum: ['admin', 'recruiter'],
    enumName: 'user_role',
    default: 'recruiter',
  })
  role!: UserRole;
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', ...TS }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', ...TS }) updatedAt!: Date;
}

@Entity('jobs')
export class JobEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'text' }) title!: string;
  @Column({ type: 'text' }) team!: string;
  @Column({ type: 'text', default: 'Remote' }) location!: string;
  @Column({ type: 'text' }) description!: string;
  @Column({
    name: 'required_skills',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  requiredSkills!: string[];
  @Column({
    type: 'enum',
    enum: ['draft', 'open', 'paused', 'closed'],
    enumName: 'job_status',
    default: 'draft',
  })
  status!: JobStatus;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @CreateDateColumn({ name: 'created_at', ...TS }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', ...TS }) updatedAt!: Date;
}

@Entity('candidates')
export class CandidateEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'citext', unique: true }) email!: string;
  @Column({ name: 'full_name', type: 'text' }) fullName!: string;
  @CreateDateColumn({ name: 'created_at', ...TS }) createdAt!: Date;
}

@Entity('applications')
@Index('applications_job_candidate_key', ['jobId', 'candidateId'], {
  unique: true,
})
export class ApplicationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'job_id', type: 'uuid' }) jobId!: string;
  @Column({ name: 'candidate_id', type: 'uuid' }) candidateId!: string;
  @Column({
    type: 'enum',
    enum: ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'],
    enumName: 'application_status',
    default: 'applied',
  })
  status!: ApplicationStatus;
  @Column({ name: 'resume_key', type: 'text', nullable: true }) resumeKey!: string | null;
  @Column({ name: 'resume_uploaded_at', ...TS, nullable: true })
  resumeUploadedAt!: Date | null;
  @Column({ name: 'screening_status', type: 'text', default: 'pending' })
  screeningStatus!: ScreeningStatus;
  @Column({ name: 'fit_score', type: 'smallint', nullable: true }) fitScore!: number | null;
  @Column({ name: 'screening_summary', type: 'text', nullable: true })
  screeningSummary!: string | null;
  @Column({
    name: 'extracted_skills',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  extractedSkills!: string[];
  @Column({ name: 'screened_at', ...TS, nullable: true })
  screenedAt!: Date | null;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', ...TS }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', ...TS }) updatedAt!: Date;
}

@Entity('application_events')
export class ApplicationEventEntity {
  @PrimaryGeneratedColumn('identity', {
    generatedIdentity: 'ALWAYS',
    type: 'bigint',
  })
  id!: string;
  @Column({ name: 'application_id', type: 'uuid' }) applicationId!: string;
  @Column({ name: 'from_status', type: 'text', nullable: true })
  fromStatus!: ApplicationStatus | null;
  @Column({ name: 'to_status', type: 'text' }) toStatus!: ApplicationStatus;
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId!: string | null;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @CreateDateColumn({ name: 'created_at', ...TS }) createdAt!: Date;
}

@Entity('outbox')
export class OutboxEntity {
  @PrimaryGeneratedColumn('identity', {
    generatedIdentity: 'ALWAYS',
    type: 'bigint',
  })
  id!: string;
  @Column({ type: 'text' }) topic!: string;
  @Column({ type: 'jsonb' }) payload!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', ...TS }) createdAt!: Date;
  @Column({ name: 'published_at', ...TS, nullable: true })
  publishedAt!: Date | null;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError!: string | null;
}

export const ENTITIES = [
  UserEntity,
  JobEntity,
  CandidateEntity,
  ApplicationEntity,
  ApplicationEventEntity,
  OutboxEntity,
];
