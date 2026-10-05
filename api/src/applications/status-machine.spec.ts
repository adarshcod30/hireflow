import { ApplicationStatus } from '../database/entities';
import { allowedNext, canMove, isTerminal, NOTIFIABLE, TRANSITIONS } from './status-machine';

const ALL: ApplicationStatus[] = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];

describe('application status machine', () => {
  // The full 7 x 7 matrix, so adding a status or a rule cannot silently change behaviour
  const LEGAL = new Set([
    'applied>screening',
    'applied>interview',
    'applied>rejected',
    'applied>withdrawn',
    'screening>interview',
    'screening>rejected',
    'screening>withdrawn',
    'interview>offer',
    'interview>rejected',
    'interview>withdrawn',
    'offer>hired',
    'offer>rejected',
    'offer>withdrawn',
  ]);
  const matrix = ALL.flatMap((from) => ALL.map((to) => [from, to, LEGAL.has(`${from}>${to}`)] as const));

  it.each(matrix)('%s to %s is %s', (from, to, legal) => {
    expect(canMove(from, to)).toBe(legal);
  });

  it('never allows a status to move to itself', () => {
    for (const status of ALL) expect(canMove(status, status)).toBe(false);
  });

  it('has exactly three end states, and nothing leaves them', () => {
    expect(ALL.filter(isTerminal).sort()).toEqual(['hired', 'rejected', 'withdrawn']);
    for (const end of ['hired', 'rejected', 'withdrawn'] as const) expect(allowedNext(end)).toEqual([]);
  });

  it('can always reach a rejection or a withdrawal until the application ends', () => {
    for (const status of ALL.filter((s) => !isTerminal(s))) {
      expect(canMove(status, 'rejected')).toBe(true);
      expect(canMove(status, 'withdrawn')).toBe(true);
    }
  });

  it('can only reach "hired" through an offer, and only moves forward', () => {
    const sources = ALL.filter((s) => canMove(s, 'hired'));
    expect(sources).toEqual(['offer']);
    const rank: Record<string, number> = {
      applied: 0,
      screening: 1,
      interview: 2,
      offer: 3,
    };
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      for (const to of tos) if (from in rank && to in rank) expect(rank[to]).toBeGreaterThan(rank[from]);
    }
  });

  it('tells the candidate about the moves that matter to them and nothing else', () => {
    expect([...NOTIFIABLE].sort()).toEqual(['hired', 'interview', 'offer', 'rejected']);
    expect(NOTIFIABLE.has('screening')).toBe(false);
    expect(NOTIFIABLE.has('withdrawn')).toBe(false);
  });
});
