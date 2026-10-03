alter table public.stock_items
  add column if not exists weight_entry_unit text,
  add column if not exists weight_ratti numeric(12,3),
  add column if not exists stone_expense_entry_mode text,
  add column if not exists stone_expense_per_ratti numeric(12,2),
  add column if not exists stone_cost_entry_mode text,
  add column if not exists stone_cost_per_ratti numeric(12,2),
  add column if not exists silver_expense_entry_mode text,
  add column if not exists silver_expense_price_per_gm numeric(12,2),
  add column if not exists silver_cost_entry_mode text,
  add column if not exists silver_cost_price_per_gm numeric(12,2),
  add column if not exists silver_cost_total_price numeric(12,2),
  add column if not exists silver_other_expenses numeric(12,2);
