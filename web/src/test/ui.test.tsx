import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DailyTrend, Histogram, PipelineDonut, Sparkline, StageBar } from '../components/charts';
import { Drawer, Modal } from '../components/overlay';
import { Avatar, Chips, EmptyState, ErrorNote, Loading, ScoreRing, StatusBadge } from '../components/ui';
import { zeroStatuses } from './helpers';

describe('ScoreRing', () => {
  it('shows the score with a spoken label and a colour band', () => {
    const { container } = render(<ScoreRing score={82} />);
    expect(screen.getByRole('img', { name: 'Fit score 82 out of 100' })).toBeInTheDocument();
    expect(container.querySelector('.score-high')).not.toBeNull();
  });

  it.each([
    ['pending', 'Awaiting resume'],
    ['processing', 'Screening'],
    ['failed', 'Not screened'],
  ] as const)('says why there is no score while %s, instead of showing a zero', (status, text) => {
    render(<ScoreRing score={null} status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not show a stale number when the screening is not done', () => {
    render(<ScoreRing score={55} status="processing" />);
    expect(screen.queryByText('55')).not.toBeInTheDocument();
  });
});

describe('Chips', () => {
  it('collapses the overflow into a count', () => {
    render(<Chips items={['a', 'b', 'c', 'd', 'e']} max={3} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b', 'c', '+2']);
  });

  it('shows everything without a limit, and nothing for an empty list', () => {
    const { rerender } = render(<Chips items={['a', 'b']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    rerender(<Chips items={[]} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('small components', () => {
  it('gives the same person the same avatar colour every time', () => {
    const { container, rerender } = render(<Avatar name="Asha Rao" />);
    const first = container.querySelector<HTMLElement>('.avatar')!.style.getPropertyValue('--hue');
    rerender(<Avatar name="Asha Rao" />);
    expect(container.querySelector<HTMLElement>('.avatar')!.style.getPropertyValue('--hue')).toBe(first);
    expect(container.querySelector('.avatar')).toHaveTextContent('AR');
  });

  it('labels statuses in words', () => {
    render(<StatusBadge status="interview" />);
    expect(screen.getByText('Interview')).toBeInTheDocument();
  });

  it('shows an API error with its reference, and nothing when there is no error', () => {
    const { rerender } = render(<ErrorNote error={{ message: 'Nope', requestId: 'req-9' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Nope');
    expect(screen.getByRole('alert')).toHaveTextContent('req-9');
    rerender(<ErrorNote error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<ErrorNote error={{}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('announces loading and empty states', () => {
    render(
      <>
        <Loading label="Loading roles" />
        <EmptyState title="Nothing yet">Come back later.</EmptyState>
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading roles...');
    expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeInTheDocument();
    expect(screen.getByText('Come back later.')).toBeInTheDocument();
  });
});

describe('charts', () => {
  it('describes the daily chart in words, since the bars carry no text', () => {
    render(
      <DailyTrend
        data={[
          { date: '2030-01-01', count: 2 },
          { date: '2030-01-02', count: 0 },
          { date: '2030-01-03', count: 4 },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Applications per day for the last 3 days, 6 in total' })).toBeInTheDocument();
  });

  it('draws one hover target per day, labelled with the count and the date', () => {
    const { container } = render(<DailyTrend data={[{ date: '2030-01-01', count: 1 }, { date: '2030-01-02', count: 4 }]} />);
    const tips = [...container.querySelectorAll('.trend-tip')].map((t) => t.textContent);
    expect(tips).toEqual(['1 applicationJan 1', '4 applicationsJan 2']);
    expect(container.querySelectorAll('.trend-line')).toHaveLength(1);
  });

  it('puts the busiest day at the top of the plot, and survives an all-zero or empty series', () => {
    const { container, rerender } = render(<DailyTrend data={[{ date: '2030-01-01', count: 1 }, { date: '2030-01-02', count: 4 }]} />);
    const heights = [...container.querySelectorAll<HTMLElement>('.trend-hit')].map((h) => h.style.getPropertyValue('--y'));
    expect(heights).toEqual(['72.5%', '14%']);
    rerender(<DailyTrend data={[{ date: '2030-01-01', count: 0 }]} />);
    expect(container.querySelector<HTMLElement>('.trend-hit')!.style.getPropertyValue('--y')).toBe('92%');
    rerender(<DailyTrend data={[]} />);
    expect(container.querySelectorAll('.trend-hit')).toHaveLength(0);
    expect(container.querySelector('.trend-line')).toBeNull();
  });

  it('lists every score band in the histogram description', () => {
    render(<Histogram data={[{ label: '0-19', count: 1 }, { label: '80-100', count: 6 }]} />);
    expect(screen.getByRole('img', { name: /0-19: 1, 80-100: 6/ })).toBeInTheDocument();
  });

  it('shows each stage with its count and share of all applications, and the total in the ring', () => {
    const { container } = render(<PipelineDonut byStatus={{ ...zeroStatuses, applied: 6, screening: 3, hired: 1 }} />);
    expect(screen.getByText('Applied').closest('li')).toHaveTextContent('660%');
    expect(screen.getByText('Screening').closest('li')).toHaveTextContent('330%');
    expect(screen.getByText('Offer').closest('li')).toHaveTextContent('00%');
    expect(container.querySelector('.donut-centre strong')).toHaveTextContent('10');
    // Only stages with someone in them get an arc
    expect(container.querySelectorAll('.donut-seg')).toHaveLength(3);
  });

  it('shows an empty ring and zero percent everywhere when there are no applications', () => {
    const { container } = render(<PipelineDonut byStatus={zeroStatuses} />);
    expect(screen.getByText('Applied').closest('li')).toHaveTextContent('00%');
    expect(container.querySelectorAll('.donut-seg')).toHaveLength(0);
    expect(container.querySelector('.donut-centre strong')).toHaveTextContent('0');
  });

  it('draws a sparkline only when there are at least two points', () => {
    const { container, rerender } = render(<Sparkline values={[1, 4, 2]} />);
    expect(container.querySelector('.spark-line')).not.toBeNull();
    rerender(<Sparkline values={[3]} />);
    expect(container.querySelector('.spark')).toBeNull();
  });

  it('summarises a job row as a stacked bar with a text equivalent, or says there is nothing', () => {
    const { rerender } = render(<StageBar byStatus={{ ...zeroStatuses, applied: 2, interview: 1 }} />);
    expect(screen.getByRole('img', { name: '2 applied, 1 interview' })).toBeInTheDocument();
    rerender(<StageBar byStatus={zeroStatuses} />);
    expect(screen.getByText('No applications')).toBeInTheDocument();
  });
});

function Host({ kind }: { kind: 'drawer' | 'modal' }) {
  const [open, setOpen] = useState(false);
  const Overlay = kind === 'drawer' ? Drawer : Modal;
  return (
    <>
      <button onClick={() => setOpen(true)}>open it</button>
      {open && (
        <Overlay title="Details" onClose={() => setOpen(false)} footer={<button>save</button>}>
          <input aria-label="first field" />
        </Overlay>
      )}
    </>
  );
}

describe.each(['drawer', 'modal'] as const)('%s behaviour', (kind) => {
  it('opens as a labelled dialog, moves focus inside and locks page scroll', async () => {
    const user = userEvent.setup();
    render(<Host kind={kind} />);
    await user.click(screen.getByRole('button', { name: 'open it' }));
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape, gives scroll back and returns focus to what opened it', async () => {
    const user = userEvent.setup();
    render(<Host kind={kind} />);
    const opener = screen.getByRole('button', { name: 'open it' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(opener).toHaveFocus();
  });

  it('closes when the backdrop or the close button is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host kind={kind} />);
    await user.click(screen.getByRole('button', { name: 'open it' }));
    await user.click(container.querySelector('.overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'open it' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside the dialog, wrapping from the last control to the first', async () => {
    const user = userEvent.setup();
    render(<Host kind={kind} />);
    await user.click(screen.getByRole('button', { name: 'open it' }));
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'save' });
    save.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it('ignores other keys', async () => {
    const onClose = vi.fn();
    const Overlay = kind === 'drawer' ? Drawer : Modal;
    const user = userEvent.setup();
    render(
      <Overlay title="Details" onClose={onClose}>
        <input aria-label="x" />
      </Overlay>,
    );
    await user.keyboard('a');
    expect(onClose).not.toHaveBeenCalled();
  });
});
