#!/bin/bash
export NODE_ENV=development
export JWT_ALGORITHM=HS256
export JWT_SECRET=test_secret_for_civitasone_32chr
export DATABASE_URL="postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_payroll"
export REDIS_URL=redis://localhost:6381
export QUEUE_DRIVER=memory
export PORT=3013
cd /home/ec2-user/CivitasOne/civitasone-suite
exec node /home/ec2-user/CivitasOne/civitasone-suite/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs services/payroll-service/src/index.ts
