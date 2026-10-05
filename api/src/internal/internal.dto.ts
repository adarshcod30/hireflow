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
  ValidateIf,
} from 'class-validator';
import { normaliseSkills } from '../common/transforms';

export class ScreeningResultDto {
  @IsIn(['done', 'failed'])
  outcome!: 'done' | 'failed';

  @ValidateIf((o: ScreeningResultDto) => o.outcome === 'done')
  @IsInt()
  @Min(0)
  @Max(100)
  fitScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @Transform(normaliseSkills)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}

export class ClaimDto {
  // bigint ids arrive as digits
  @Matches(/^\d{1,19}$/)
  outboxId!: string;
}

export class StaleQuery {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
