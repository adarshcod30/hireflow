import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '../common/pagination';
import { trim, trimLower } from '../common/transforms';
import { ApplicationStatus } from '../database/entities';

export const APPLICATION_STATUSES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
] as const;

export class ApplyDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;
}

export class TransitionDto {
  @IsIn(APPLICATION_STATUSES)
  to!: ApplicationStatus;

  /** The version the recruiter was looking at. If someone else changed it meanwhile, the move is refused. */
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ApplicationListQuery extends PageQuery {
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;
}

/** The cross-job candidates view: any combination of these narrows the list. */
export class AllApplicationsQuery extends ApplicationListQuery {
  @IsOptional()
  @IsUUID()
  jobId?: string;

  /** Matches part of a candidate's name or email. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Only applications whose screening score is at least this. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;
}
