#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
test_user_id="55555555-5555-4555-8555-555555555555"
source_account_id="55555555-5555-4555-8555-555555555501"
destination_account_id="55555555-5555-4555-8555-555555555502"
operation_id="55555555-5555-4555-8555-555555555503"
task_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-v82-concurrency.XXXXXX")"

cleanup() {
  docker exec -i "$db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || true
delete from public.transactions where user_id = '$test_user_id';
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
insert into auth.users(id,email)
values ('$test_user_id','concurrency-v82@example.invalid');
insert into public.accounts(id,user_id,name,opening_balance,statement_balance)
values
  ('$source_account_id','$test_user_id','Concurrency source',1000,1000),
  ('$destination_account_id','$test_user_id','Concurrency destination',0,0);
SQL

run_request() {
  local output_file="$1"
  docker exec -i "$db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >"$output_file" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$test_user_id',true);
select pg_sleep(0.5);
select (public.create_transfer_v82(
  '$operation_id',
  '$source_account_id',
  '$destination_account_id',
  125.50,
  '2026-08-20',
  'Concurrent transfer'
)).operation_id;
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
if [[ "$request_one_status" -ne 0 ]]; then
  echo "first concurrent request failed" >&2
  exit 1
fi
assertions=$((assertions + 1))

if [[ "$request_two_status" -ne 0 ]]; then
  echo "second concurrent request failed" >&2
  exit 1
fi
assertions=$((assertions + 1))

row_count="$(docker exec -i "$db_container" psql -U postgres -d postgres -X -Atc "select count(*) from public.transactions where user_id='$test_user_id' and operation_id='$operation_id';")"
if [[ "$row_count" != "1" ]]; then
  echo "concurrent operation persisted $row_count canonical rows" >&2
  exit 1
fi
assertions=$((assertions + 1))

matching_payload="$(docker exec -i "$db_container" psql -U postgres -d postgres -X -Atc "select count(*) from public.transactions where user_id='$test_user_id' and operation_id='$operation_id' and transaction_type='transferencia' and status='realizado' and source_account_id='$source_account_id' and destination_account_id='$destination_account_id' and amount=125.50;")"
if [[ "$matching_payload" != "1" ]]; then
  echo "canonical concurrent operation payload is inconsistent" >&2
  exit 1
fi
assertions=$((assertions + 1))

partial_rows="$(docker exec -i "$db_container" psql -U postgres -d postgres -X -Atc "select count(*) from public.transactions where user_id='$test_user_id' and operation_id='$operation_id' and (source_account_id is null or destination_account_id is null or source_account_id=destination_account_id);")"
if [[ "$partial_rows" != "0" ]]; then
  echo "concurrent operation left an invalid or partial row" >&2
  exit 1
fi
assertions=$((assertions + 1))

echo "v82 operation_id concurrency: 1 scenario, ${assertions} assertions passed"
