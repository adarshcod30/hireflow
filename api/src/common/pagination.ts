import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Keyset (cursor) pagination. A page is "the rows after this one in a fixed
 * order", so inserts between requests do not shift or repeat rows, and the cost
 * of page 500 is the same as page 1 (an index seek, not an OFFSET scan).
 *
 * The order is always (created_at DESC, id DESC): the id breaks ties between
 * rows created in the same millisecond.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export class PageQuery {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export const DEFAULT_LIMIT = 20;

export interface Cursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [iso, id] = parsed as [unknown, unknown];
      if (typeof iso === 'string' && typeof id === 'string' && UUID.test(id)) {
        const createdAt = new Date(iso);
        if (!Number.isNaN(createdAt.getTime())) return { createdAt, id };
      }
    }
  } catch {
    // fall through to the error below
  }
  throw new BadRequestException('Invalid cursor');
}

/** Build a page from `limit + 1` fetched rows: the extra row only says "there is more". */
export function toPage<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
  };
}
