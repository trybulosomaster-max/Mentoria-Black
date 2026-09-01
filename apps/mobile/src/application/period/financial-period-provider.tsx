import { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useState } from 'react';

import {
  calendarMonthKey,
  currentMonthWindow,
  sameCalendarMonth,
  shiftCalendarMonth,
  type CalendarMonth,
} from '../../lib/format';

type FinancialPeriodContextValue = Readonly<{
  period: CalendarMonth;
  periodKey: string;
  setPeriod(period: CalendarMonth): void;
  movePeriod(offset: number): void;
}>;

const FinancialPeriodContext = createContext<FinancialPeriodContextValue | null>(null);

function initialPeriod(): CalendarMonth {
  const current = currentMonthWindow();
  return Object.freeze({ year: current.year, month: current.month });
}

export function FinancialPeriodProvider({ children }: PropsWithChildren) {
  const [period, setPeriodState] = useState<CalendarMonth>(initialPeriod);
  const setPeriod = useCallback((next: CalendarMonth) => {
    calendarMonthKey(next);
    setPeriodState((current) => sameCalendarMonth(current, next)
      ? current
      : Object.freeze({ year: next.year, month: next.month }));
  }, []);
  const movePeriod = useCallback((offset: number) => {
    setPeriodState((current) => shiftCalendarMonth(current, offset));
  }, []);
  const periodKey = calendarMonthKey(period);
  const value = useMemo<FinancialPeriodContextValue>(
    () => ({ period, periodKey, setPeriod, movePeriod }),
    [movePeriod, period, periodKey, setPeriod],
  );
  return <FinancialPeriodContext.Provider value={value}>{children}</FinancialPeriodContext.Provider>;
}

export function useFinancialPeriod(): FinancialPeriodContextValue {
  const context = useContext(FinancialPeriodContext);
  if (!context) throw new Error('useFinancialPeriod deve ser usado dentro de FinancialPeriodProvider.');
  return context;
}
