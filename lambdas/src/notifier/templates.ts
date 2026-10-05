export interface Email {
  subject: string;
  text: string;
  html: string;
}

interface Payload {
  candidateName?: string;
  jobTitle?: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Candidate names and job titles are typed by users. They must never be able to inject markup. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Anything going into a header must be one line, or it can smuggle in extra headers. */
export const oneLine = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

const paragraphs = (lines: string[]) => ({
  text: lines.join('\n\n'),
  html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n'),
});

/** The email for a topic, or null for a topic the candidate does not hear about. */
export function renderEmail(topic: string, payload: Record<string, unknown>): Email | null {
  const p = payload as Payload;
  const name = oneLine(p.candidateName ?? 'there');
  const job = oneLine(p.jobTitle ?? 'the role');

  if (topic === 'application.submitted') {
    return {
      subject: `We received your application for ${job}`,
      ...paragraphs([
        `Hi ${name},`,
        `Thank you for applying for ${job}. We have your application and a recruiter will review it.`,
        'You will hear from us when there is an update.',
      ]),
    };
  }

  if (topic === 'application.status_changed') {
    const to = typeof payload.to === 'string' ? payload.to : '';
    const bodies: Record<string, { subject: string; lines: string[] }> = {
      interview: {
        subject: `Next step for your application for ${job}`,
        lines: [
          `Hi ${name},`,
          `Good news: we would like to interview you for ${job}. A recruiter will contact you with times.`,
        ],
      },
      offer: {
        subject: `An offer for ${job}`,
        lines: [
          `Hi ${name},`,
          `We are delighted to offer you the ${job} role. A recruiter will follow up with the details.`,
        ],
      },
      hired: {
        subject: `Welcome aboard, ${name}`,
        lines: [`Hi ${name},`, `Welcome to the team. We are glad you will be joining us as ${job}.`],
      },
      rejected: {
        subject: `Your application for ${job}`,
        lines: [
          `Hi ${name},`,
          `Thank you for the time you put into applying for ${job}. We will not be taking your application further this time.`,
          'We wish you every success and encourage you to apply again for future roles.',
        ],
      },
    };
    const body = bodies[to];
    return body ? { subject: body.subject, ...paragraphs(body.lines) } : null;
  }

  return null;
}
