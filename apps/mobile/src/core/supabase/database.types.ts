export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TransactionRow = {
  account_id: string | null;
  amount: number;
  asset_id: string | null;
  card_billing_cycle_id: string | null;
  card_id: string | null;
  category: string | null;
  created_at: string;
  description: string;
  destination_account_id: string | null;
  goal_effect: string | null;
  goal_id: string | null;
  id: string;
  installment_number: number | null;
  installment_series_id: string | null;
  installment_total: number | null;
  liability_id: string | null;
  note: string | null;
  operation_id: string | null;
  payment_method: string | null;
  purchase_date: string | null;
  recurring_occurrence_date: string | null;
  recurring_series_id: string | null;
  reversal_of_id: string | null;
  source_account_id: string | null;
  status: string | null;
  subcategory: string | null;
  transaction_date: string;
  transaction_type: string;
  updated_at: string;
  user_id: string;
};

export type AccountRow = {
  account_type: string;
  balance_as_of: string | null;
  created_at: string;
  id: string;
  institution: string | null;
  last_reconciled_at: string | null;
  name: string;
  note: string | null;
  opening_balance: number;
  statement_balance: number | null;
  user_id: string;
};

export type CardRow = {
  brand: string | null;
  closing_day: number | null;
  created_at: string;
  due_day: number | null;
  id: string;
  institution: string | null;
  limit: number;
  name: string;
  note: string | null;
  user_id: string;
};

export type GoalRow = {
  cadence: string | null;
  created_at: string;
  current: number;
  deadline: string | null;
  id: string;
  name: string;
  note: string | null;
  target: number;
  user_id: string;
};

export type MonthlyPlanRow = {
  comfort: number;
  created_at: string;
  fixed_expenses: number;
  goals: number;
  id: string;
  investments: number;
  knowledge: number;
  leisure: number;
  month: number;
  revenue: number;
  updated_at: string;
  user_id: string;
  year: number;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      transactions: Table<TransactionRow>;
      accounts: Table<AccountRow>;
      cards: Table<CardRow>;
      goals: Table<GoalRow>;
      monthly_plans: Table<MonthlyPlanRow>;
    };
    Views: Record<string, never>;
    Functions: {
      get_my_entitlements: {
        Args: never;
        Returns: Json;
      };
      start_my_app_trial: {
        Args: never;
        Returns: Array<{
          result: string;
          trial_state: string;
          started_at: string | null;
          expires_at: string | null;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
