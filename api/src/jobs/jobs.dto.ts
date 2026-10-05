import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PageQuery } from '../common/pagination';
import { normaliseSkills } from '../common/transforms';
import { JobStatus } from '../database/entities';

const JOB_STATUSES = ['draft', 'open', 'paused', 'closed'] as const;

export class CreateJobDto {
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

export class UpdateJobDto {
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

export class JobListQuery extends PageQuery {
  @IsOptional() @IsIn(JOB_STATUSES) status?: JobStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class PublicJobListQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
