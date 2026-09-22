#!/usr/bin/env bash
# Start / stop the local test stack (PostgreSQL 16 + Supabase-compatible shim).
# Usage: tests/e2e/localstack/stack.sh start|stop|reset
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/tmp/sl-pg/data
PSQL="psql -h /tmp/sl-pg -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
start_pg() {
  if [ ! -d "$PGDATA" ]; then
    mkdir -p /tmp/sl-pg && chown postgres /tmp/sl-pg
    su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" > /tmp/sl-pg/initdb.log
  fi
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p 54329 -k /tmp/sl-pg' -l /tmp/sl-pg/pg.log status" >/dev/null 2>&1 || \
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p 54329 -k /tmp/sl-pg' -l /tmp/sl-pg/pg.log -w start" >/dev/null
}
reset_db() {
  $PSQL -c "drop database if exists screenlab with (force)" -c "create database screenlab"
  $PSQL -d screenlab -f "$DIR/bootstrap.sql"
  $PSQL -d screenlab -f "$ROOT/supabase/migrations/20260922000001_screenlab_schema.sql" 2>&1 | grep -v NOTICE || true
  $PSQL -d screenlab -c "insert into auth.users(id,email,encrypted_password,email_confirmed_at,aud,role) values
    ('af75b6c9-225e-4f05-b03c-be08be841d4e','e2e-a@screenlab.test',crypt('E2e-test-password-1',gen_salt('bf')),now(),'authenticated','authenticated'),
    ('0901688c-4622-43dc-99c6-346e83e84957','e2e-b@screenlab.test',crypt('E2e-test-password-1',gen_salt('bf')),now(),'authenticated','authenticated')"
  rm -rf /tmp/sl-storage
}
stop_shim() {
  if [ -f /tmp/sl-stack.pid ]; then kill "$(cat /tmp/sl-stack.pid)" 2>/dev/null || true; rm -f /tmp/sl-stack.pid; fi
}
start_shim() {
  stop_shim
  nohup node "$DIR/server.mjs" > /tmp/sl-stack.log 2>&1 &
  echo $! > /tmp/sl-stack.pid
  for i in $(seq 1 30); do [ -f /tmp/sl-anon-key.txt ] && grep -q "test stack" /tmp/sl-stack.log && break; sleep 0.2; done
}
case "$1" in
  start) start_pg; start_shim; echo "stack up: http://localhost:54321" ;;
  reset) start_pg; stop_shim; reset_db; start_shim; echo "stack reset: http://localhost:54321" ;;
  stop) stop_shim; su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop" >/dev/null 2>&1 || true; echo "stack stopped" ;;
  *) echo "usage: $0 start|stop|reset"; exit 1 ;;
esac
