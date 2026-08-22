#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
test_user_id="75555555-5555-4555-8555-555555555555"
source_account_id="75555555-5555-4555-8555-555555555501"
asset_id="75555555-5555-4555-8555-555555555502"
series_id="75555555-5555-4555-8555-555555555503"
task_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-v82-recurring-concurrency.XXXXXX")"

cleanup() {
  docker exec -i "$db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || true
delete from public.transactions where user_id = '$test_user_id';
delete from public.recurring where user_id = '$test_user_id';
delete from public.assets where user_id = '$test_user_id';
delete from public.accounts where user_id = '$test_user_id';
delete from auth.users where id = '$test_user_id';
SQL
  rm -rf "$task_tmp_dir"
}
trap cleanup EXIT

if ! docker inspect "$db_container" >/dev/null 2>&1; then
  echo "local Supabase database container not found: $db_container" >&2
  exit 1
fi

container_project="$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')"
if [[ "$container_project" != "$project_id" ]]; then
  echo "refusing to run against an unexpected Docker project" >&2
  exit 1
fi

docker exec -i "$db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into auth.users(id,email) values ('$test_user_id','recurring-concurrency-v82@example.invalid');
insert into public.accounts(id,user_id,name,opening_balance,statement_balance)
values ('$source_account_id','$test_user_id','Recurring concurrency source',1000,1000);
insert into public.assets(id,user_id,name,opening_value,current_value)
values ('$asset_id','$test_user_id','Recurring concurrency asset',0,0);
insert into public.recurring(
  id,user_id,name,type,amount,account_id,source_account_id,asset_id,
  frequency,"interval",start_date,next_date,end_date,active
) values (
  '$series_id','$test_user_id','Concurrent investment','investimento',125,
  '$source_account_id','$source_account_id','$asset_id',
  'monthly',1,current_date,current_date,current_date,true
);
SQL

run_request() {
  local output_file="$1"
  docker exec -i "$db_container" psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 >"$output_file" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$test_user_id',true);
select count(*) from public.materialize_recurring_occurrences_v82(current_date);
commit;
SQL
}

run_request "$task_tmp_dir/request-1.log" &
request_one_pid=$!
run_request "$task_tmp_dir/request-2.log" &
request_two_pid=$!

request_one_status=0
request_two_status=0
wait "$request_one_pid" || request_one_status=$?
wait "$request_two_pid" || request_two_status=$?

assertions=0
if [[ "$request_one_status" -ne 0 || "$request_two_status" -ne 0 ]]; then
  echo "a concurrent recurring request failed" >&2
  exit 1
fi
assertions=$((assertions + 2))

returned_total="$(awk '/^[01]$/{sum+=$1} END{print sum+0}' "$task_tmp_dir/request-1.log" "$task_tmp_dir/request-2.log")"
if [[ "$returned_total" != "1" ]]; then
  echo "concurrent materialization returned $returned_total inserted rows" >&2
  exit 1
fi
assertions=$((assertions + 1))

row_count="$(docker exec -i "$db_container" psql -U postgres -d postgres -X -Atc "select count(*) from public.transactions where user_id='$test_user_id' and recurring_series_id='$series_id' and recurring_occurrence_date=current_date;")"
if [[ "$row_count" != "1" ]]; then
  echo "concurrent materialization persisted $row_count canonical rows" >&2
  exit 1
fi
assertions=$((assertions + 1))

matching_shape="$(docker exec -i "$db_container" psql -U postgres -d postgres -X -Atc "select count(*) from public.transactions where user_id='$test_user_id' and recurring_series_id='$series_id' and transaction_type='investimento' and source_account_id='$source_account_id' and asset_id='$asset_id' and amount=125;")"
if [[ "$matching_shape" != "1" ]]; then
  echo "concurrent recurring investment shape is inconsistent" >&2
  exit 1
fi
assertions=$((assertions + 1))

advanced="$(docker exec -i "$db_container" psql -U postgres -d postgres -X -Atc "select count(*) from public.recurring where id='$series_id' and next_date>current_date;")"
if [[ "$advanced" != "1" ]]; then
  echo "concurrent materialization did not advance the series exactly once" >&2
  exit 1
fi
assertions=$((assertions + 1))

echo "v82 recurring concurrency: 1 scenario, ${assertions} assertions passed"
