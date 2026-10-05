import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor, toPage } from './pagination';

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, n)),
});

describe('cursor pagination', () => {
  describe('cursors', () => {
    it('round-trips a row exactly, including its millisecond', () => {
      const original = {
        id: '0a1b2c3d-0000-4000-8000-0123456789ab',
        createdAt: new Date('2030-05-06T07:08:09.123Z'),
      };
      const decoded = decodeCursor(encodeCursor(original));
      expect(decoded).toEqual(original);
      expect(decoded?.createdAt.getTime()).toBe(original.createdAt.getTime());
    });

    it('is opaque and URL-safe', () => {
      expect(encodeCursor(row(1))).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it.each([undefined, ''])('treats %p as "start from the beginning"', (value) => {
      expect(decodeCursor(value)).toBeNull();
    });

    it.each([
      ['not base64 json', '%%%'],
      ['an empty array', Buffer.from('[]').toString('base64url')],
      ['the wrong shape', Buffer.from('{"a":1}').toString('base64url')],
      ['a non-uuid id', Buffer.from(JSON.stringify(['2030-01-01T00:00:00.000Z', 'abc'])).toString('base64url')],
      [
        'an invalid date',
        Buffer.from(JSON.stringify(['yesterday-ish', '00000000-0000-4000-8000-000000000001'])).toString('base64url'),
      ],
      ['numbers instead of strings', Buffer.from(JSON.stringify([1, 2])).toString('base64url')],
      [
        'SQL in the id',
        Buffer.from(JSON.stringify(['2030-01-01T00:00:00.000Z', "1' OR '1'='1"])).toString('base64url'),
      ],
    ])('rejects %s with 400', (_label, raw) => {
      expect(() => decodeCursor(raw)).toThrow(BadRequestException);
    });
  });

  describe('toPage', () => {
    it('returns everything and no cursor when the rows fit in one page', () => {
      const page = toPage([row(3), row(2), row(1)], 5);
      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    });

    it('returns exactly a full page and no cursor when there is no extra row', () => {
      expect(toPage([row(3), row(2)], 2).nextCursor).toBeNull();
    });

    it('uses the extra row only as a signal, and points the cursor at the last row actually returned', () => {
      const rows = [row(5), row(4), row(3), row(2)]; // limit 3 + one extra
      const page = toPage(rows, 3);
      expect(page.items.map((r) => r.id)).toEqual([row(5).id, row(4).id, row(3).id]);
      expect(decodeCursor(page.nextCursor ?? undefined)).toEqual(row(3));
    });

    it('handles an empty result', () => {
      expect(toPage([], 10)).toEqual({ items: [], nextCursor: null });
    });
  });
});
