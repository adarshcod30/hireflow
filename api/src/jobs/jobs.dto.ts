import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQuery } from '../common/pagination';
import { normaliseSkills } from '../common/transforms';
import { EmploymentType, JobStatus, SalaryPeriod, WorkMode } from '../database/entities';

const JOB_STATUSES = ['draft', 'open', 'paused', 'closed'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship'] as const;
export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export const SALARY_PERIODS = ['hour', 'month', 'year'] as const;

/** Compensation and contract details, shared by create and update. Every field is optional. */
class JobDetailsDto {
  @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: EmploymentType;
  @IsOptional() @IsIn(WORK_MODES) workMode?: WorkMode;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) salaryMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) salaryMax?: number;
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'salaryCurrency must be a three letter ISO code such as USD' })
  salaryCurrency?: string;
  @IsOptional() @IsIn(SALARY_PERIODS) salaryPeriod?: SalaryPeriod;
}

export class CreateJobDto extends JobDetailsDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(100) team!: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsString() @MinLength(10) @MaxLength(10_000) description!: string;

  @IsOptional()
  @Transform(normaliseSkills)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  requiredSkills?: string[];

  @IsOptional() @IsIn(JOB_STATUSES) status?: JobStatus;
}

export class UpdateJobDto extends JobDetailsDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) team?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @Transform(normaliseSkills)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  requiredSkills?: string[];

  @IsOptional() @IsIn(JOB_STATUSES) status?: JobStatus;
}

export class PublicJobListQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(WORK_MODES) workMode?: WorkMode;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: EmploymentType;
}

export class JobListQuery extends PublicJobListQuery {
  @IsOptional() @IsIn(JOB_STATUSES) status?: JobStatus;
}
