#!/bin/sh
# Container start: migrate, seed the demo template once (from the frozen ledger, no AI key needed), then serve.
set -e
cd /app/apps/api
alembic upgrade head
if python -c "
from sqlalchemy import select
from baton.db.models import Workspace
from baton.db.session import SessionLocal
db = SessionLocal()
raise SystemExit(0 if db.scalar(select(Workspace.id).where(Workspace.is_demo_template.is_(True))) else 1)
"; then
  echo "demo template already present"
else
  python -m baton.seed_demo --frozen
fi
exec uvicorn baton.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*"
