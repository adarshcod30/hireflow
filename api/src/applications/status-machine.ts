import { ApplicationStatus } from '../database/entities';

/**
 * The hiring pipeline as an explicit state machine. A move that is not listed
 * here is refused, so an application can never jump from "applied" to "hired"
 * or come back to life after being rejected.
 */
export const TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  applied: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export const allowedNext = (from: ApplicationStatus): readonly ApplicationStatus[] => TRANSITIONS[from];

export const canMove = (from: ApplicationStatus, to: ApplicationStatus): boolean => TRANSITIONS[from].includes(to);

export const isTerminal = (status: ApplicationStatus): boolean => TRANSITIONS[status].length === 0;

/** The candidate hears about these moves, and only these. */
export const NOTIFIABLE: ReadonlySet<ApplicationStatus> = new Set(['interview', 'offer', 'hired', 'rejected']);
