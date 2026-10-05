import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
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
