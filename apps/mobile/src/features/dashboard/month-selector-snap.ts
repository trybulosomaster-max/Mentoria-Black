export type MonthSnapPhase = 'idle' | 'dragging' | 'settling';

export type MonthSnapState = Readonly<{
  phase: MonthSnapPhase;
}>;

export type MonthSnapTransition = Readonly<{
  state: MonthSnapState;
  commitIndex: number | null;
}>;

export type MonthSnapEvent =
  | Readonly<{ type: 'drag-begin' }>
  | Readonly<{
    type: 'drag-end';
    offset: number;
    targetOffset?: number;
    velocityX?: number;
    interval: number;
    itemCount: number;
  }>
  | Readonly<{ type: 'momentum-begin' }>
  | Readonly<{
    type: 'momentum-end';
    offset: number;
    interval: number;
    itemCount: number;
  }>;

export const INITIAL_MONTH_SNAP_STATE: MonthSnapState = Object.freeze({ phase: 'idle' });

const ALIGNMENT_TOLERANCE = 1;
const VELOCITY_TOLERANCE = 0.01;

export function monthIndexAtSnap(offset: number, interval: number, itemCount: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(interval) || interval <= 0 || itemCount <= 0) return 0;
  return Math.max(0, Math.min(itemCount - 1, Math.round(offset / interval)));
}

function isDefinitivelySettled(event: Extract<MonthSnapEvent, { type: 'drag-end' }>): boolean {
  const index = monthIndexAtSnap(event.offset, event.interval, event.itemCount);
  const snappedOffset = index * event.interval;
  const aligned = Math.abs(event.offset - snappedOffset) <= ALIGNMENT_TOLERANCE;
  const stationary = event.velocityX !== undefined
    && Math.abs(event.velocityX) <= VELOCITY_TOLERANCE;
  const targetIndex = event.targetOffset === undefined
    ? index
    : monthIndexAtSnap(event.targetOffset, event.interval, event.itemCount);
  const targetAligned = event.targetOffset === undefined
    || Math.abs(event.targetOffset - snappedOffset) <= ALIGNMENT_TOLERANCE;
  return aligned && stationary && targetAligned && targetIndex === index;
}

export function transitionMonthSnap(
  state: MonthSnapState,
  event: MonthSnapEvent,
): MonthSnapTransition {
  if (event.type === 'drag-begin') {
    return Object.freeze({ state: Object.freeze({ phase: 'dragging' }), commitIndex: null });
  }

  if (event.type === 'drag-end') {
    if (state.phase !== 'dragging') return Object.freeze({ state, commitIndex: null });
    if (isDefinitivelySettled(event)) {
      return Object.freeze({
        state: INITIAL_MONTH_SNAP_STATE,
        commitIndex: monthIndexAtSnap(event.offset, event.interval, event.itemCount),
      });
    }
    return Object.freeze({ state: Object.freeze({ phase: 'settling' }), commitIndex: null });
  }

  if (event.type === 'momentum-begin') {
    if (state.phase === 'idle') return Object.freeze({ state, commitIndex: null });
    return Object.freeze({ state: Object.freeze({ phase: 'settling' }), commitIndex: null });
  }

  if (state.phase === 'idle') return Object.freeze({ state, commitIndex: null });
  return Object.freeze({
    state: INITIAL_MONTH_SNAP_STATE,
    commitIndex: monthIndexAtSnap(event.offset, event.interval, event.itemCount),
  });
}
