import type { SupabaseClient } from '@supabase/supabase-js';

import { requireSupabaseClient } from '../../core/supabase/client';
import type {
  AccountRow,
  CardRow,
  GoalRow,
  MonthlyPlanRow,
  TransactionRow,
  Database,
} from '../../core/supabase/database.types';
import { summarizeRealized } from '../../domain/finance/foundation-financial-read-model';
import { currentMonthWindow, saoPauloCalendar } from '../../lib/format';

export type MobileSnapshot = Readonly<{
  generatedAt: string;
  period: Readonly<{ year: number; month: number; label: string }>;
  metrics: Readonly<{
    realizedIncome: number;
    realizedExpense: number;
    realizedInvestment: number;
    monthlyCashFlow: number;
    unclassifiedTransactions: number;
    knownAccountBalance: number;
    accountsWithSnapshot: number;
    accountsTotal: number;
    configuredCardLimit: number;
    goalsSaved: number;
    goalsTarget: number;
  }>;
  transactions: readonly TransactionRow[];
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  goals: readonly GoalRow[];
  monthlyPlan: MonthlyPlanRow | null;
}>;

function firstError(results: readonly { error: { message: string } | null }[]) {
  return results.find((result) => result.error)?.error ?? null;
}

async function loadAllTransactions(
  client: SupabaseClient<Database>,
  start: string,
  endExclusive: string,
  userId: string,
): Promise<TransactionRow[]> {
  const pageSize = 500;
  const maximumRows = 10_000;
  const rows: TransactionRow[] = [];

  for (let from = 0; from < maximumRows; from += pageSize) {
    const result = await client
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('transaction_date', start)
      .lt('transaction_date', endExclusive)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (result.error) throw new Error('Não foi possível carregar os lançamentos do período.');
    const page = (result.data ?? []) as TransactionRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }

  throw new Error('O período excede o limite seguro de leitura. Refine o intervalo antes de continuar.');
}

export async function loadMobileSnapshot(userId: string): Promise<MobileSnapshot> {
  if (!userId) throw new Error('Usuário obrigatório para carregar dados financeiros.');
  const client = requireSupabaseClient();
  const window = currentMonthWindow();
  const calendar = saoPauloCalendar();

  const [transactions, accountsResult, cardsResult, goalsResult, planResult] = await Promise.all([
    loadAllTransactions(client, window.start, window.endExclusive, userId),
    client.from('accounts').select('*').eq('user_id', userId).order('name', { ascending: true }),
    client.from('cards').select('*').eq('user_id', userId).order('name', { ascending: true }),
    client.from('goals').select('*').eq('user_id', userId).order('deadline', { ascending: true, nullsFirst: false }),
    client
      .from('monthly_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('year', window.year)
      .eq('month', window.month)
      .maybeSingle(),
  ]);

  const error = firstError([
    accountsResult,
    cardsResult,
    goalsResult,
    planResult,
  ]);
  if (error) throw new Error('Não foi possível carregar os dados financeiros.');

  const accounts = (accountsResult.data ?? []) as AccountRow[];
  const cards = (cardsResult.data ?? []) as CardRow[];
  const goals = (goalsResult.data ?? []) as GoalRow[];
  const monthlyPlan = (planResult.data ?? null) as MonthlyPlanRow | null;
  const realized = summarizeRealized(transactions, calendar.today);
  const accountsWithSnapshot = accounts.filter((account) => account.statement_balance !== null);
  const knownAccountBalance = accountsWithSnapshot.reduce(
    (total, account) => total + Number(account.statement_balance ?? 0),
    0,
  );
  const configuredCardLimit = cards.reduce((total, card) => total + Number(card.limit || 0), 0);
  const goalsSaved = goals.reduce((total, goal) => total + Number(goal.current || 0), 0);
  const goalsTarget = goals.reduce((total, goal) => total + Number(goal.target || 0), 0);

  return Object.freeze({
    generatedAt: new Date().toISOString(),
    period: Object.freeze({ year: window.year, month: window.month, label: window.label }),
    metrics: Object.freeze({
      realizedIncome: realized.income,
      realizedExpense: realized.expense,
      realizedInvestment: realized.investment,
      monthlyCashFlow: realized.availableBalanceDelta,
      unclassifiedTransactions: realized.unclassified,
      knownAccountBalance,
      accountsWithSnapshot: accountsWithSnapshot.length,
      accountsTotal: accounts.length,
      configuredCardLimit,
      goalsSaved,
      goalsTarget,
    }),
    transactions: Object.freeze(transactions),
    accounts: Object.freeze(accounts),
    cards: Object.freeze(cards),
    goals: Object.freeze(goals),
    monthlyPlan,
  });
}
