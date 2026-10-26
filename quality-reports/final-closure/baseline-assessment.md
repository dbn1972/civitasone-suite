# Baseline assessment

<!-- V4-CERT-BEGIN -->
## V4 certification refresh 2026-10-26 (frozen SHA `66b04aedd827b7e4fdcb402731d6d45a678badc8`)

Scope: MASTER PROMPT V4.0 certification of the integrated main commit `66b04aedd827b7e4fdcb402731d6d45a678badc8` (66b04aedd, the squash of bundle #2280; bundles #2279 `e845c0401` and #2281 `400dbc822` are ancestors). Discovery baseline was `1eaeecae7`. This section was written by the Release Certification Auditor on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` into it (no history rewrite). The certification lanes were read-only on code. Anything not executed is marked NOT_RUN; no gate is claimed that was not run or read from a recorded result.

**Release decision (V4): FAIL.** Detail in `release-readiness.md`. Earlier sections of this file are kept below unchanged as history.

### V4 baseline and environment

- Frozen SHA: `66b04aedd827b7e4fdcb402731d6d45a678badc8` (file `~/orch-logs/closure/v4/FROZEN_SHA`). Chain: discovery baseline `1eaeecae7` -> #2227 `96e536cf9` -> #2279 `e845c0401` -> #2281 `400dbc822` -> #2280 `66b04aedd` (4 release commits, 685 files, 28 new migration files, no number collisions).
- Host: cloudsphere-ec2 aarch64, node v22.23.2 (host) / 22.23.4 (container), pnpm 9.0.0 (`cert/build.json`). DB tests ran on disposable `postgis/postgis:16-3.4` (amd64 emulated on an arm64 host, so timing-sensitive results can differ from CI) in private docker network namespaces, with redis:7-alpine, non-superuser service roles, `scripts/ci/bootstrap-postgres.sh` (exit 0). The shared dev Postgres (:5435) was not used for tests (one disclosed exception below).
- Lanes: build, db, contract-e2e, security-perf, regression (certification), after discovery lanes A-G, remediation (83 agents), cycle 2 (20 agents). Result files: `~/orch-logs/closure/v4/cert/{build,db,contract-e2e,security-perf,regression}.json`.
- Disclosure: during the contract-e2e lane one stray `psql` probe to the shared dev Postgres :5435 was attempted by mistake while checking port isolation; it failed password authentication and read nothing. No pushes, merges or code changes were made by any certification lane.
- Prior baseline (earlier refreshes) is retained below.

### V4 gate matrix (every executed step with command, exit code, UTC times, log, sha256)

Statuses are the lanes' own, except where the step is a diagnostic rerun or not relied on (marked). Lane summaries in `cert/*.json` are authoritative for the narrative; the rows below come from `build/results.tsv`, `contract-e2e/*.{cmd,exit,start,end,sha}`, `db.json`, `security-perf.json`, `regression.json`.

| Lane | Gate / step | Status | Command (verbatim) | Exit | Start UTC | End UTC | Log | sha256 |
|---|---|---|---|---|---|---|---|---|
| build | g1-install | PASS |  | 0 | 2026-10-26T02:21:51Z | 2026-10-26T02:21:59Z | ~/orch-logs/closure/v4/cert/build/g1-install.log | a60f21e1997a203a22ac2ef3ece3347af2cb12f7b55240286e1b8c0c740cc801 |
| build | g2-turbo-build | PASS |  | 0 | 2026-10-26T02:22:03Z | 2026-10-26T02:34:37Z | ~/orch-logs/closure/v4/cert/build/g2-turbo-build.log | 3211132b057a223255530370a8864b157739cc543ab92c6855458105b44885e5 |
| build | g3-typecheck | NOT_RELIED_ON (turbo cache replay) |  | 0 | 2026-10-26T02:34:37Z | 2026-10-26T02:34:40Z | ~/orch-logs/closure/v4/cert/build/g3-typecheck.log | 756603ca60fd966176b60672b28755973c043e6f0c86d1a5232092a8565a8f11 |
| build | g3-lint | NOT_RELIED_ON (turbo cache replay) |  | 0 | 2026-10-26T02:34:40Z | 2026-10-26T02:34:43Z | ~/orch-logs/closure/v4/cert/build/g3-lint.log | fa7a4623ce4993b290822867bb5201984ca0d4e21b5455963324f486e7069fa9 |
| build | g3-jsx-a11y | PASS |  | 0 | 2026-10-26T02:34:43Z | 2026-10-26T02:36:02Z | ~/orch-logs/closure/v4/cert/build/g3-jsx-a11y.log | ea19329148215f3ca878f889a94c13fbe7d74967c4e5af151d908cf85f7315dd |
| build | g3-typecheck-force | PASS |  | 0 | 2026-10-26T02:42:28Z | 2026-10-26T02:47:15Z | ~/orch-logs/closure/v4/cert/build/g3-typecheck-force.log | a5b25a1debf3ddecf1ae0415f61b890dafbd5d82548f521223f3d753d08d35ba |
| build | g3-lint-force | PASS |  | 0 | 2026-10-26T02:47:15Z | 2026-10-26T02:49:45Z | ~/orch-logs/closure/v4/cert/build/g3-lint-force.log | bfffb42d7eb614321aa7980194124a12360ae1c48b46c166a94af5e8e2b7c531 |
| build | a01-db-per-service | PASS |  | 0 | 2026-10-26T03:02:06Z | 2026-10-26T03:02:07Z | ~/orch-logs/closure/v4/cert/build/a01-db-per-service.log | b4e8f19868308199d913c092fc961aa74047795898c165bac2ee7c2887aa27ad |
| build | a02-package-exports | PASS |  | 0 | 2026-10-26T03:02:07Z | 2026-10-26T03:02:07Z | ~/orch-logs/closure/v4/cert/build/a02-package-exports.log | 202de7758adb0ac5b5094d59df182034cfb358a5bbfde26d444c88117ac3e1f2 |
| build | a03-deployment-declaration | PASS |  | 0 | 2026-10-26T03:02:07Z | 2026-10-26T03:02:07Z | ~/orch-logs/closure/v4/cert/build/a03-deployment-declaration.log | dbe2832a0dce6b9a8d56863e7f835e82ed3c9cb1ce629d68c1741992c9d4b771 |
| build | a04-ci-config | PASS |  | 0 | 2026-10-26T03:02:07Z | 2026-10-26T03:02:07Z | ~/orch-logs/closure/v4/cert/build/a04-ci-config.log | 15cbdf961fcd1cb85e06fd64cfd8fd6c8d22fc80570e19fa50bcb17077c464ae |
| build | a05-test-ledger-poison | PASS |  | 0 | 2026-10-26T03:02:07Z | 2026-10-26T03:02:07Z | ~/orch-logs/closure/v4/cert/build/a05-test-ledger-poison.log | 19c525ed2d9336c1abb3170706dedcf28a51431d99be00d90ad45078ad68d410 |
| build | a06-raw-status-leak-tests | PASS |  | 0 | 2026-10-26T03:02:07Z | 2026-10-26T03:02:09Z | ~/orch-logs/closure/v4/cert/build/a06-raw-status-leak-tests.log | e20b41dd721bf68ef7df4bfaf15e91cf0e13e1a7f6335881e085c988bdeacf67 |
| build | a07-raw-status-leak | PASS |  | 0 | 2026-10-26T03:02:09Z | 2026-10-26T03:02:10Z | ~/orch-logs/closure/v4/cert/build/a07-raw-status-leak.log | 0d409a563aff0d59e4a9f7913dc9dcfcf8b1f088a108280027a2a37d4b5de5ae |
| build | a08-no-cross-service-db-joins | PASS |  | 0 | 2026-10-26T03:02:10Z | 2026-10-26T03:02:10Z | ~/orch-logs/closure/v4/cert/build/a08-no-cross-service-db-joins.log | dc51b8c96c2d745df3bd5590d990230a482fd247123599548e0632fdbf97fc22 |
| build | a09-no-console-log | PASS |  | 0 | 2026-10-26T03:02:10Z | 2026-10-26T03:02:10Z | ~/orch-logs/closure/v4/cert/build/a09-no-console-log.log | dc51b8c96c2d745df3bd5590d990230a482fd247123599548e0632fdbf97fc22 |
| build | a10-no-exported-any | PASS |  | 0 | 2026-10-26T03:02:10Z | 2026-10-26T03:02:11Z | ~/orch-logs/closure/v4/cert/build/a10-no-exported-any.log | dc51b8c96c2d745df3bd5590d990230a482fd247123599548e0632fdbf97fc22 |
| build | a11-ops-regression-locks | PASS |  | 0 | 2026-10-26T03:02:11Z | 2026-10-26T03:02:13Z | ~/orch-logs/closure/v4/cert/build/a11-ops-regression-locks.log | bd63eb4b4027b8fe801c3df9c67b4527adea57881c42ea9a599176fd4659cf7e |
| build | a12-tenant-router | PASS |  | 0 | 2026-10-26T03:02:13Z | 2026-10-26T03:02:13Z | ~/orch-logs/closure/v4/cert/build/a12-tenant-router.log | cd363c506d8fadc3bcb65b503b6b985087c6eee46e8908dd7967ce871e4b2e56 |
| build | b-raw-session-guc-tests | PASS |  | 0 | 2026-10-26T03:02:13Z | 2026-10-26T03:02:15Z | ~/orch-logs/closure/v4/cert/build/b-raw-session-guc-tests.log | 984b7b08acc27ae3c619fad193eebfa822b8891fdcccd60c8a8a28da8ed560df |
| build | b-raw-session-guc | PASS |  | 0 | 2026-10-26T03:02:15Z | 2026-10-26T03:02:17Z | ~/orch-logs/closure/v4/cert/build/b-raw-session-guc.log | d7071af74e618315e15b58ece4bf562adc911f5e4de111d24a2deaa6ef3f5218 |
| build | b-fastify-bodylimit-tests | PASS |  | 0 | 2026-10-26T03:02:17Z | 2026-10-26T03:02:21Z | ~/orch-logs/closure/v4/cert/build/b-fastify-bodylimit-tests.log | 588a87dcce83114238e0480e48aed82527bcb19e5ecc222f7b7e11e9b17849f9 |
| build | b-fastify-bodylimit | PASS |  | 0 | 2026-10-26T03:02:21Z | 2026-10-26T03:02:22Z | ~/orch-logs/closure/v4/cert/build/b-fastify-bodylimit.log | 10ff3c12dc230a1824d680dc5780d37cfcc2715019b277968f493f908994aa1d |
| build | b-empty-vs-error-tests | PASS |  | 0 | 2026-10-26T03:02:22Z | 2026-10-26T03:02:24Z | ~/orch-logs/closure/v4/cert/build/b-empty-vs-error-tests.log | 4286bb456ca469638ed55186c8b44fa2557f2c0b538551da16dfb0c92b808f5b |
| build | b-empty-vs-error | PASS |  | 0 | 2026-10-26T03:02:24Z | 2026-10-26T03:02:26Z | ~/orch-logs/closure/v4/cert/build/b-empty-vs-error.log | d510666422bcc88547884e1e1c12163d38e649b493fa524236a0544bbdf3992b |
| build | b-tenant-table-rls-tests | PASS |  | 0 | 2026-10-26T03:02:26Z | 2026-10-26T03:02:28Z | ~/orch-logs/closure/v4/cert/build/b-tenant-table-rls-tests.log | cd3c7518d30f887371de80de1b98fe1edc05ae05e6805d90128f7978997741e6 |
| build | b-tenant-table-rls | FAIL |  | 1 | 2026-10-26T03:02:28Z | 2026-10-26T03:02:28Z | ~/orch-logs/closure/v4/cert/build/b-tenant-table-rls.log | 326eb12bafadcc427c51da8ca83c3beb0206d89c40aa4dafc1ff6f85ad54c412 |
| build | b-nested-tx-tests | PASS |  | 0 | 2026-10-26T03:02:29Z | 2026-10-26T03:02:31Z | ~/orch-logs/closure/v4/cert/build/b-nested-tx-tests.log | 51fa7096ea55fdae17ad39266c781e595708734fd6cff166c0056e2ff05d5f29 |
| build | b-nested-tx | PASS |  | 0 | 2026-10-26T03:02:31Z | 2026-10-26T03:02:32Z | ~/orch-logs/closure/v4/cert/build/b-nested-tx.log | 04651ee032f418a4838b34d0e88c09a9fb2b60dedf8c0937eb7f2127d3ec5dce |
| build | b-evidence-suite-dbs-tests | PASS |  | 0 | 2026-10-26T03:02:32Z | 2026-10-26T03:02:34Z | ~/orch-logs/closure/v4/cert/build/b-evidence-suite-dbs-tests.log | d85f4b8292e912084b7a90f863304bcfd1dcb983a58bf35ddb443047bc92d54f |
| build | b-evidence-suite-dbs | PASS |  | 0 | 2026-10-26T03:02:34Z | 2026-10-26T03:02:34Z | ~/orch-logs/closure/v4/cert/build/b-evidence-suite-dbs.log | 954cadaf48b3a20768494868f8869d4194dc7daf5534207310bdedffed9d717e |
| build | b-flaky-skip-tests | PASS |  | 0 | 2026-10-26T03:02:34Z | 2026-10-26T03:02:37Z | ~/orch-logs/closure/v4/cert/build/b-flaky-skip-tests.log | 9957bda79b7f6c2db29df5d751b70a0d5cd0134e2de4164c918a8d73b89fa257 |
| build | b-flaky-skip | FAIL |  | 1 | 2026-10-26T03:02:37Z | 2026-10-26T03:02:38Z | ~/orch-logs/closure/v4/cert/build/b-flaky-skip.log | 6abecf6ead6a88affb577b810ee0e04eece2e47f6ceb33e93778ad936a059178 |
| build | b-authz-tenant-scanner-tests | PASS |  | 0 | 2026-10-26T03:02:38Z | 2026-10-26T03:02:39Z | ~/orch-logs/closure/v4/cert/build/b-authz-tenant-scanner-tests.log | f6dab45e798b2871249c4d8c775c84c308f4315a2ea37aa48a3623a6e2628733 |
| build | b-authz-tenant-scanner | FAIL |  | 1 | 2026-10-26T03:02:40Z | 2026-10-26T03:02:41Z | ~/orch-logs/closure/v4/cert/build/b-authz-tenant-scanner.log | efe40dc420de51aa972cc1a01e88452f215d27766a01371a6c808fd61ac9a39a |
| build | b-queue-publish-messageid-tests | PASS |  | 0 | 2026-10-26T03:02:41Z | 2026-10-26T03:02:43Z | ~/orch-logs/closure/v4/cert/build/b-queue-publish-messageid-tests.log | c8e3c1816d9257f2a5a43abccb89d63f94b81fd050e605f0277985152bc677b8 |
| build | b-queue-publish-messageid | PASS |  | 0 | 2026-10-26T03:02:43Z | 2026-10-26T03:02:48Z | ~/orch-logs/closure/v4/cert/build/b-queue-publish-messageid.log | a17004aa4895a5de3074a7bde2fe3cfa52f98211830ef9fb6d1d904cbe2f35ae |
| build | b-stat-tile-literal-tests | PASS |  | 0 | 2026-10-26T03:02:48Z | 2026-10-26T03:02:51Z | ~/orch-logs/closure/v4/cert/build/b-stat-tile-literal-tests.log | edeaee48d90da900f17f4e352c12e65194cc972222b27c4cb81da9cb81c23d51 |
| build | b-stat-tile-literal | PASS |  | 0 | 2026-10-26T03:02:51Z | 2026-10-26T03:02:54Z | ~/orch-logs/closure/v4/cert/build/b-stat-tile-literal.log | 94376dde9e0113477e8d49e56c32ce769d1e915ba800d2f763eb984ba82f4f74 |
| build | b-datatable-render-tests | PASS |  | 0 | 2026-10-26T03:02:54Z | 2026-10-26T03:02:56Z | ~/orch-logs/closure/v4/cert/build/b-datatable-render-tests.log | e78bfaec639fe3ae1fa4869f6d4e0e024789334a07987c62743d5be7b19444ca |
| build | b-datatable-render | PASS |  | 0 | 2026-10-26T03:02:56Z | 2026-10-26T03:02:57Z | ~/orch-logs/closure/v4/cert/build/b-datatable-render.log | 1f0837b0dffe454c79bdd13207328beb6b1a75c92c50e9e753c532f2c0bec27a |
| build | s01-secret-scanner | PASS |  | 0 | 2026-10-26T03:02:57Z | 2026-10-26T03:03:01Z | ~/orch-logs/closure/v4/cert/build/s01-secret-scanner.log | 3ec9ae4d5634a5e484d1d69f2db999cecc878e53e5b788a36d08d40c7dd7e181 |
| build | s02-ci-secret-scan-grep | PASS |  | 0 | 2026-10-26T03:03:01Z | 2026-10-26T03:03:03Z | ~/orch-logs/closure/v4/cert/build/s02-ci-secret-scan-grep.log | 2e22da2ab13713309ac75219e525b8e06ed02f3f1963b8feef203fa25827f93d |
| build | g4-turbo-test | FAIL |  | 1 | 2026-10-26T03:16:38Z | 2026-10-26T04:01:21Z | ~/orch-logs/closure/v4/cert/build/g4-turbo-test.log | 80c57b0d6cf9b9676a3565955c5e4385c14d7704a982275902f64460137f9660 |
| build | r-ocr-host | PASS (diagnostic rerun) |  | 0 | 2026-10-26T04:13:03Z | 2026-10-26T04:13:41Z | ~/orch-logs/closure/v4/cert/build/r-ocr-host.log | 5a1b41e1a3c28e15ccb279a70dbac0c4a1ff794da9d75952272762dfeb8e794c |
| build | g2-web-tsc | PASS |  | 0 | 2026-10-26T04:13:58Z | 2026-10-26T04:14:09Z | ~/orch-logs/closure/v4/cert/build/g2-web-tsc.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| build | g4-bootstrap-pg2 | PASS |  | 0 | 2026-10-26T04:12:43Z | 2026-10-26T04:20:44Z | ~/orch-logs/closure/v4/cert/build/g4-bootstrap-pg2.log | 82bc1790dc6f8862e383b2a1c969491402ff97372dccbd403be1b69ad96155b1 |
| build | r-citizen-service | FAIL (diagnostic rerun) |  | 1 | 2026-10-26T04:20:50Z | 2026-10-26T04:22:05Z | ~/orch-logs/closure/v4/cert/build/r-citizen-service.log | 4210045daadebcb903e81f9d6b6ba92e339eafcd4cd7c1b7b4e7565c456c2b63 |
| build | g2-web-next-build | PASS |  | 0 | 2026-10-26T04:14:09Z | 2026-10-26T04:22:23Z | ~/orch-logs/closure/v4/cert/build/g2-web-next-build.log | c600ad0a180976b00a38c13ffc9dcb40b2830a47c8f347f82cbe43d83db8d981 |
| build | r-audit-service | PASS (diagnostic rerun) |  | 0 | 2026-10-26T04:22:05Z | 2026-10-26T04:22:40Z | ~/orch-logs/closure/v4/cert/build/r-audit-service.log | e51aa6ce66dca7f0446a12d4050d4955b653a2b177d01c27e67a1acee31f50a4 |
| build | r-grant-service | FAIL (diagnostic rerun) |  | 1 | 2026-10-26T04:22:40Z | 2026-10-26T04:23:10Z | ~/orch-logs/closure/v4/cert/build/r-grant-service.log | 421e5a26889fab745078d50f0079bec02705ca1df5dad8fc810e2369b369aa76 |
| build | r-grant-solo | PASS (diagnostic rerun) |  | 0 | 2026-10-26T04:23:21Z | 2026-10-26T04:23:26Z | ~/orch-logs/closure/v4/cert/build/r-grant-solo.log | e6ef48b4ad111b3bd04758907525701206002be2896bc20f0e52f9ad42ca1d3b |
| build | r-citizen-solo | FAIL (diagnostic rerun) |  | 1 | 2026-10-26T04:23:31Z | 2026-10-26T04:23:41Z | ~/orch-logs/closure/v4/cert/build/r-citizen-solo.log | a56a05187d28129271e0f51585c7923ae270fe3046f0bbef10d7759959d7fd06 |
| build | g4-bootstrap-pg(run1) | DISCARDED (first DB) |  | 0 | 2026-10-26T02:24:47Z | 2026-10-26T02:35:00Z | ~/orch-logs/closure/v4/cert/build/g4-bootstrap-pg(run1).log | 5a406fafd7998e4a3d851d34c5a7a8743c43d3d2db352dd37ba90aa91f8cd71b |
| contract-e2e | 6a tests/contract (5 files) | FAIL | `pnpm exec vitest run --maxWorkers=2 tests/contract/gateway.contract.test.ts tests/contract/cross-service-events.contract.test.ts tests/contract/screens.contract.test.ts tests/contract/crm-link-integrity.contract.test.ts tests/contract/route-existence.contract.test.ts` | 1 | 2026-10-26T02:21:58Z | 2026-10-26T02:22:18Z | ~/orch-logs/closure/v4/cert/contract-e2e/c1.log | 62bbc48637286f477752d85909bb45202605f2039bc8e14a2d722937052d757a |
| contract-e2e | 6b remaining tests/contract (4 files) | PASS | `pnpm exec vitest run --maxWorkers=2 tests/contract/command-result.contract.test.ts tests/contract/disciplinary-case-actions-parity.contract.test.ts tests/contract/global-search-routes.contract.test.ts tests/contract/hr-role-matrix.contract.test.ts` | 0 | 2026-10-26T02:26:25Z | 2026-10-26T02:26:32Z | ~/orch-logs/closure/v4/cert/contract-e2e/c2b.log | e16349cf78fbfda61eba796d642546a5ab95fcc26516b800aa8ff5436e50bd93 |
| contract-e2e | 7 scripts/contract/score.mjs static-only (informational, NOT a valid gate result) | NOT_RUN | `node scripts/contract/score.mjs` | 1 | 2026-10-26T02:26:37Z | 2026-10-26T02:26:37Z | ~/orch-logs/closure/v4/cert/contract-e2e/score.log | bb9d0cc44c76910a7e6cdc785883c8d378437aaf49ca0cbeb71dc0ae2e78717f |
| contract-e2e | 19a tests/cross-service-live full dir | FAIL | `CI=true PGHOST=127.0.0.1 PGPORT=56432 CACHE_DRIVER=memory pnpm exec vitest run --maxWorkers=2 tests/cross-service-live/` | 1 | 2026-10-26T02:34:49Z | 2026-10-26T02:35:15Z | ~/orch-logs/closure/v4/cert/contract-e2e/xs.log | 2b2ebd4140551af213d89ba1c163a16da04e329c7e891e14098230667251d7c3 |
| contract-e2e | 19b payroll-posting-history isolated | FAIL | `CI=true PGHOST=127.0.0.1 PGPORT=56432 CACHE_DRIVER=memory pnpm exec vitest run --maxWorkers=1 tests/cross-service-live/payroll-posting-history.test.ts` | 1 | 2026-10-26T02:35:22Z | 2026-10-26T02:35:28Z | ~/orch-logs/closure/v4/cert/contract-e2e/xs2.log | 447dd5f4818ee2f748390b95b1e72b2fcd30019e4524edce5dad93514293369d |
| contract-e2e | 19c module-gating-standalone.live | PASS | `CI=true PGHOST=127.0.0.1 PGPORT=56432 CACHE_DRIVER=memory DATABASE_URL=postgres://admin_svc:admin_dev_pw@127.0.0.1:56432/civitas_admin pnpm exec vitest run --maxWorkers=1 tests/cross-service-live/module-gating-standalone.live.test.ts` | 0 | 2026-10-26T02:35:36Z | 2026-10-26T02:35:44Z | ~/orch-logs/closure/v4/cert/contract-e2e/xs3.log | 1a07f57792fa4534983d27593fe5cedd130efa3413f722920c5d2a7e30089c81 |
| db | db-setup (pnpm install frozen + packages build) | PASS | `cd ~/worktrees/cert-db && pnpm install --frozen-lockfile --prefer-offline ; cd ~/worktrees/cert-db && pnpm turbo build --filter="./packages/*"` | 0 | 2026-10-26T02:22:05Z | 2026-10-26T02:23:40Z | /home/ec2-user/orch-logs/closure/v4/cert/db/install.log, /home/ec2-user/orch-logs/closure/v4/cert/db/build-packages.log | install=185609a12186176d78185870bf38496229caaa6039a090418c37c99b3bf5d339, build-packages=3b59a20127c458e89a85c470dd2059620d1a99db06ab0ab7303b0b47e73cec92 |
| db | G16 bootstrap-postgres.sh | PASS | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && bash scripts/ci/bootstrap-postgres.sh"` | 0 | 2026-10-26T02:23:41Z | 2026-10-26T02:32:34Z | /home/ec2-user/orch-logs/closure/v4/cert/db/bootstrap.log | bootstrap=5489cdfd2ca307b1b9a29a0942dcdd7eb129937c0073340ecd339e3601bbed4d |
| db | G16 tenant-index-guard + schema-drift-guard | PASS | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && node scripts/ci/tenant-index-guard.mjs" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && POSTGRES_ADMIN_USER=civitas POSTGRES_ADMIN_PASSWORD=civitas_test node scripts/ci/schema-drift-guard.mjs"` | 0 | 2026-10-26T02:32:59Z | 2026-10-26T02:33:24Z | /home/ec2-user/orch-logs/closure/v4/cert/db/g-tenant-index.log, /home/ec2-user/orch-logs/closure/v4/cert/db/g-schema-drift.log | g-tenant-index=382a43cc75fdec8050995d7f1ae365e710dfb4ab87c3a1579052a70704c392fd, g-schema-drift=9a16de9c7c33c1421bbfe3a3260b832b73639dfcd8a229c2adc3189bc8ae7529 |
| db | G9/G10 authz-tenant-scanner unit tests | PASS | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && pnpm exec vitest run tests/architecture/authz-tenant-scanner.test.ts"` | 0 | 2026-10-26T02:33:22Z | 2026-10-26T02:33:24Z | /home/ec2-user/orch-logs/closure/v4/cert/db/g-authz-scanner-tests.log | g-authz-scanner-tests=3b1a21c56da600b93038042b0a3bcb6994d129c6e1037795e00e617e6568f45b |
| db | G9/G10 authz-tenant-scanner (SEC-014 ratchet) | FAIL | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && node scripts/ci/authz-tenant-scanner.mjs"` | 1 | 2026-10-26T02:33:21Z | 2026-10-26T02:33:22Z | /home/ec2-user/orch-logs/closure/v4/cert/db/g-authz-scanner.log | g-authz-scanner=efe40dc420de51aa972cc1a01e88452f215d27766a01371a6c808fd61ac9a39a |
| db | G11/G12 root integration (outbox/idempotency/concurrent-writes/chains) + eOffice loop-back | PASS | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && pnpm exec vitest run tests/integration/" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && CACHE_DRIVER=memory pnpm exec vitest run --maxWorkers=2 tests/cross-service-live/eoffice-smarttransfer-callbacks.test.ts"` | 0 | 2026-10-26T02:33:24Z | 2026-10-26T02:33:58Z | /home/ec2-user/orch-logs/closure/v4/cert/db/root-integration.log, /home/ec2-user/orch-logs/closure/v4/cert/db/root-xsl-eoffice.log | root-integration=45a0e86e43557ffbec68149005c86bde92ec439246b31b901d329f489bf81dcf, root-xsl-eoffice=abe54a4fc0092ea47a01db507738c9fbd754ac4b9443e5cb63b77d1150a5b3c2 |
| db | G11 tenant-isolation / IDOR / RLS-GUC (tests/security) | FAIL | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && pnpm exec vitest run --maxWorkers=2 tests/security/" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && pnpm exec vitest run --maxWorkers=2 tests/security/"` | 1 | 2026-10-26T02:33:25Z | 2026-10-26T03:16:37Z | /home/ec2-user/orch-logs/closure/v4/cert/db/root-security.log, /home/ec2-user/orch-logs/closure/v4/cert/db/rerun-root-security.log | root-security=97774cbc8a89bda8f80c1ae038adaf618091cb59710d1ef9f9be4bbfd3d4ef39, rerun-root-security=d6b585bcc3b2c7c3d5d595ed27585794518a6470f54686283afb63bab85eaebf |
| db | G13 DB-integrity (tests/data-integrity: RLS no-GUC, PII at rest, money types) | FAIL | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && pnpm exec vitest run --maxWorkers=2 tests/data-integrity/"` | 1 | 2026-10-26T02:33:35Z | 2026-10-26T02:33:46Z | /home/ec2-user/orch-logs/closure/v4/cert/db/root-data-integrity.log | root-data-integrity=70cf79c485f7bb7d68b3bc5d0794e59bab166aa1cbfec38fe0f4e32002373f00 |
| db | G12 cross-service flows (tests/cross-service, informational: not in ci.yml test job) | FAIL | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && pnpm exec vitest run --maxWorkers=2 tests/cross-service/"` | 1 | 2026-10-26T02:33:46Z | 2026-10-26T02:33:53Z | /home/ec2-user/orch-logs/closure/v4/cert/db/root-cross-service.log | root-cross-service=34bededf74e82a331c373379c2690afbee4f76096d89742882710cb247f61840 |
| db | G5/G9 service suites with DB: 67 services, vitest run --maxWorkers=2, 2 at a time | FAIL | `/home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/advertisement-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/ai-agent-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/analytics-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/animal-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/admin-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/audit-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/asset-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/building-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/catalogue-service && pnpm exec vitest run --maxWorkers=2" ; /home/ec2-user/orch-logs/closure/v4/cert/db/nsrun.sh "cd ~/worktrees/cert-db && cd services/billing-service && pnpm exec vitest run --maxWorkers=` | 1 | 2026-10-26T02:33:55Z | 2026-10-26T03:14:35Z | /home/ec2-user/orch-logs/closure/v4/cert/db/<name>.log (see summary.json) | svc-advertisement-service=5dbc9c20e709e01dd14ecd4a481ed5a8f299081ef30c98d8beb5ab7cc29d235f, svc-ai-agent-service=b2a9698dbf35b6a1b88eec12185d8159d0a3a8778cd0e147c7d05c015d0ef4d7, svc-analytics-service=82e30bf441e921b71d8fb6c00fe06785fc3ff2384e9ecf279c0a68647f852ff4, svc-animal-service=d2058f4216ad6a9199b6aa7712a1066a68f8f28998f00732b2aead2d050764ce, svc-admin-service=3a4d98e7e716268b7379652ddc5f5313dfc2babeed81b8956822eb81cc9b191f, svc-audit-service=7a8d5efc894fcb7473411273742c1c05e6ca490764d773c6dd08eb526cf11307, svc-asset-service=0486d18af5e1173a14d865a4faa157638e6c049800f209c1275d8bf3f9477648, svc-building-service=77a9ac01678d2c23496cc6ea4262f4e15a80d871f69b6ab7c82c756f4a6041ba, svc-catalogue-service=4da0b5a930759682efcd2b6c83bbaf8914feabb681f370a4f6ba55fade8d4df6, svc-billing-service=ec1798b8805dd9476615095032cdff801800ef4615c985bb02eb02d2ef48f8eb, svc-cdp-service=86df91c04918330aafedc583670f5da284514ebe9749f0860488e2d95fb050a3, svc-contract-service=4109abcae0b33fc85af0852a3222c47b5bb31cfc20e85d4026b532df27160084, svc-citizen-service=881ec08062f59f6614b90d771a3bd4bcf278ef8d78afe93f6ca906a9dc759b31, svc-court-service=a1c4b33676fc0fbb53bdd3b8e4ddae63aa99cd8d9ba61c7501fbf048ef805433, svc-crematorium-service=b1d6a777a13757d63e292fca7e1fb5a79a0bd32b46e722e8d04fb2a8025aa70c, svc-document-service=bb72dcc25c6faaf89752a3128a7305054cc606f26e786bb519f5d591ea2a27e9, svc-drainage-service=beaed8017de371ddc2dedf33e92d68e18e3b95b3a76ab6845b60eb8845bebc50, svc-estab-service=aa999c86d8351efcb15d51f51adce7843a577e69466bfc8279a50b9f2dbf83dd, svc-event-service=96ea54d12a380241593af01cd92a7b08a6d0bae395355bb93df081e806feb537, svc-field-service=3975fb29191f8fc6a53b49ebf9e3a5ed1f3836ac7f388d485da779d7efd50b7e, svc-crm-service=bc7060a685d850700884d7aeab7abd69b535340911e5f71676a6b6074d7fb942, svc-fire-service=f63d780c3a286e60d841b7601413f40616aadd35b2d5ba8d6ab0dee12a5fb108, svc-gateway-service=100d6d9a1faa944759b0343dd37d5eec82d9930800f1598025a39d81fa232b6e, svc-grant-service=8cd4c16793e007c44c5834cbe73e7b3fd1df6b469abec5a145a25c6f8dff4f75, svc-helpdesk-service=94c2f5a0b4cf3e68366dce1873feb8628b9f7e09e1bab52fc162fe1a57e73d56, svc-finance-service=e2f9e0e53bdfbff70c7378d63a2b9b6fe830d370830fd5892cecd644c875c1e3, svc-identity-service=c90c31248b28559475b930b6fa2e24ae14330005208bc4f7c335293e9f4f7858, svc-inspection-service=0936832d29bd42143a549abdcb14d5a4161fa0c33b9ee976e96bc2f5ccde7c62, svc-install-service=c3275989d893780c02f1a8356036bf9504691beee8cd64ed3f97ff30a95a1101, svc-inventory-service=e9dffd44ae9abf490995c1f4836f92bb681e963d2d0c7ec7258925a32a51c61e, svc-journey-service=c84b5760248778aa2e78b93cc05347da29ce9d9aef7bfdd68d89c5420d777795, svc-knowledge-service=630fd8c050e1d3e7ae6d9e7221938636588f7475198b2370741f7ba68d0d280f, svc-legal-service=755d27409f37d6f8315ec2a7e74359bc7c9f50f67dc701c97bc7a582ae6822f6, svc-location-service=96bc1032c46763a6552897a6422cee526e04262d52fe3b2c52a7af37d920accf, svc-loyalty-service=f71df304553956962639f65242cf0557bd7fdeb1f816416845fbc9687 |
| db | G16 workflow/maker-checker, outbox/idempotency, concurrency (within service suites) | FAIL |  |  |  |  |  |  |
| db | Web tsc / next build / LocalStack cross-process / Keycloak e2e | NOT_RUN |  |  |  |  |  |  |
| security-perf | 14_dependency_scan | PASS_WITH_KNOWN | `node scripts/ci/cve-audit-gate.mjs` | 0 | 2026-10-26T02:21:48Z | 2026-10-26T02:24:57Z | cve-gate.log | SHA256SUMS in ~/orch-logs/closure/v4/cert/security-perf/ |
| security-perf | 15_trivy | NOT_RUN |  |  |  |  | see lane note | SHA256SUMS in ~/orch-logs/closure/v4/cert/security-perf/ |
| security-perf | codeql_alerts | FAIL |  |  |  |  | see lane note | SHA256SUMS in ~/orch-logs/closure/v4/cert/security-perf/ |
| security-perf | 17_performance_load | NOT_RUN |  |  |  |  | see lane note | SHA256SUMS in ~/orch-logs/closure/v4/cert/security-perf/ |
| security-perf | 18_resilience | PASS_WITH_KNOWN |  |  |  |  | see lane note | SHA256SUMS in ~/orch-logs/closure/v4/cert/security-perf/ |
| regression | 20a-v4-pr-regression-tests | FAIL | `per package: run-suite.sh -> pnpm exec vitest run (79 test files from 47 V4 PRs, DATABASE_URL -> disposable postgis:16-3.4 on 127.0.0.1:55912, bootstrap via scripts/ci/bootstrap-postgres.sh EXIT=0)` | 1 |  |  | /home/ec2-user/orch-logs/closure/v4/cert/regression | per-log hashes in ~/orch-logs/closure/v4/cert/regression/log-hashes.json |
| regression | 20b-run3-and-delta-regression-tests | FAIL | `run-suite.sh over jobs-delta.txt (244 test files added/modified between 1eaeecae7 and the SHA, 55 packages, MW=1 --no-file-parallelism) covering closure run-3 bundles #2227/#2279 and V4 bundles #2280/#2281` | 1 |  |  | /home/ec2-user/orch-logs/closure/v4/cert/regression/run-delta.out | per-log hashes in ~/orch-logs/closure/v4/cert/regression/log-hashes.json |
| regression | 20c-revert-proves-test-fails | PASS | `git apply -R <PR source diff excluding test files> in separate worktree, run PR tests, git checkout -- . (10 HIGH fixes)` | 0 |  |  | /home/ec2-user/orch-logs/closure/v4/cert/regression/revert-summary.txt | per-log hashes in ~/orch-logs/closure/v4/cert/regression/log-hashes.json |
| regression | 20d-delta-static-integration-review | PASS_WITH_KNOWN | `git diff 1eaeecae7 SHA; migration prefix scan of 28 new migration files; git grep conflict markers; pnpm exec tsc --noEmit in 55 changed services/packages` | 0 |  |  | /home/ec2-user/orch-logs/closure/v4/cert/regression/tsc-summary.txt | per-log hashes in ~/orch-logs/closure/v4/cert/regression/log-hashes.json |
| regression | 20e-web-tsc-next-build | NOT_RUN |  |  |  |  |  | per-log hashes in ~/orch-logs/closure/v4/cert/regression/log-hashes.json |

### Gates not run

| Lane | Gate | Status | Reason |
|---|---|---|---|
| build | 4b Gateway SEC-021 real-subprocess test (GATEWAY_SPAWN_TESTS=1) | NOT_RUN | omitted for time after the main test failures; containers torn down |
| build | 14 gitleaks (local) | NOT_RUN | gitleaks not installed on cloudsphere-ec2 (GitHub CI ran it: FAIL, see CI table) |
| contract-e2e | 6c render-smoke contract (apps/web jsdom) | NOT_RUN | not executed in the lane (GitHub CI Contract Tests job executed it) |
| contract-e2e | 7 scripts/contract/score.mjs 10/10 on a live stack | NOT_RUN | needs live gateway stack on fixed shared ports |
| contract-e2e | 8 Playwright E2E; 19d journey e2e (tests/e2e-live, tests/e2e-personas, apps/web/e2e) | NOT_RUN | needs full live stack; prefer-CI rule |
| contract-e2e | mobile integration tests (apps/mobile Flutter) | NOT_RUN | flutter/dart not installed on EC2 |
| db | Web tsc / next build / LocalStack cross-process / Keycloak e2e | NOT_RUN | out of scope for the db lane; LocalStack absent (tests/integration/cross-process.localstack.test.ts skipped) |
| security-perf | 15 Trivy (local) | NOT_RUN | no local Trivy for the SHA (GitHub Security Scan Trivy jobs ran: see CI table) |
| security-perf | 17 Performance/load (k6 scripts/perf, tests/load; service N+1 suites) | NOT_RUN | needs a booted stack on shared dev Postgres/Redis, forbidden by the lane rules; only packages/db perf 3/3 and packages/cache perf-007 6/6 ran |
| regression | 20e web tsc / next build | NOT_RUN | outside the regression lane (build lane ran them: PASS) |

### GitHub CI evidence for the frozen SHA (read-only, snapshot 2026-10-26T04:42:48Z, query log `cert/reports/ci-run-*.json`)

This is executed evidence from GitHub, not from this host. Both runs ended with conclusion failure.

- CI run 40258410831 (commit 66b04aedd), run conclusion **failure** at snapshot 2026-10-26T04:42:48Z; 67 Docker image jobs: {'success': 67}
- Security Scan run 40258410829 (commit 66b04aedd), run conclusion **failure** at snapshot 2026-10-26T04:42:48Z

| Workflow run | Job | Conclusion |
|---|---|---|
| CI 40258410831 | Tests | failure |
| CI 40258410831 | Secret Scan | success |
| CI 40258410831 | Mobile (Flutter) | success |
| CI 40258410831 | Web Build | success |
| CI 40258410831 | Architecture Guard | failure |
| CI 40258410831 | Typecheck & Lint | success |
| CI 40258410831 | E2E (Playwright) | success |
| CI 40258410831 | Procurement E2E Gate | success |
| CI 40258410831 | Accessibility (WCAG 2.2 AA, axe-core) | success |
| CI 40258410831 | Quality Gates — Domain (L10) & Canary (L11) | success |
| CI 40258410831 | Screen Verification Gate | success |
| CI 40258410831 | Contract Tests | failure |
| CI 40258410831 | Mutation Testing (Stryker) | success |
| CI 40258410831 | Live Stack Verification | success |
| CI 40258410831 | QA Readiness | success |
| CI 40258410831 | Derive Docker Build Matrix | success |
| CI 40258410831 | Release Gate (evidence audit) | failure |
| CI 40258410831 | Quality Gates — Schema Integrity (L3) | skipped |
| CI 40258410831 | Coverage Gate | skipped |
| CI 40258410831 | Integration Tests | skipped |

| Workflow run | Job | Conclusion |
|---|---|---|
| Security Scan 40258410829 | Secret Scan | failure |
| Security Scan 40258410829 | CodeQL SAST (javascript-typescript) | success |
| Security Scan 40258410829 | Trivy Container Scan (hrms-service) | success |
| Security Scan 40258410829 | Trivy Container Scan (gateway-service) | success |
| Security Scan 40258410829 | Dependency Audit (hygiene) | success |
| Security Scan 40258410829 | Trivy Container Scan (finance-service) | success |
| Security Scan 40258410829 | CVE / SCA Gate | success |
| Security Scan 40258410829 | ZAP DAST (gateway baseline) | success |

Failing jobs: **Tests**: @civitasone/citizen-service#test (service-gaps-partial-routes, V4-INTEG-01) and @civitasone/web#test (auditResource, V4-CERT-02); 121 of 123 turbo tasks passed; **Architecture Guard**: tenant-table-rls-guard, flaky-skip-guard, authz-tenant-scanner (V4-CERT-03/04/05); **Contract Tests**: cross-service-events contract: stale baseline entry + new orphan event (V4-CERT-06/07); **Release Gate (evidence audit)**: L3 and L6 UNMEASURED (no evidence artifact), SLO UNMEASURED (no L7-k6-slo.json); L3 Schema Integrity, Coverage Gate, Integration Tests jobs were skipped because Tests failed (FINAL-GATE-02); **Secret Scan**: gitleaks: leaks found 2 (generic-api-key) in services/queue-service/vitest.config.ts:10 and services/hrms-service/src/modules/leave/comp-off-authz.test.ts:32, values redacted (V4-CERT-17)
<!-- V4-CERT-END -->

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

### Baselines

- Run 1: frozen baseline SHA `f82d57053f55237ace2515c8b84398923f3df5f7`; discovery in `discover-1..6.json`, result in `~/orch-logs/closure/pass1-result.json`.
- Run 2: baseline was the then-current origin/main (verifier refers to `53f343019`), about 32 fix PRs after Run 1. Excluded: defects already in Run 1 `confirmedLow`/`blockedForApproval`, items in `deferred-approval.md`, files touched by PRs #2147, #2163, #2175 and #2172. Discovery files: `run2-discover-1.json` (16), `-2` (9), `-3` (12), `-4` (0), `-5` (3), `-6` (13). IDs `CLOS2-S<n>-NN`.
- Final-check baseline for this refresh: main `9d93535e57b686e557cb36d998008a5f9687e1a6`. Guards that failed at the Run 1 baseline and now pass: money-precision (151 findings), secret-scanner (71), sql-injection (24), package-exports (10), per final checks. Caveat: those counts are from the Run 1 baseline records; I did not re-derive them.

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

Frozen baseline SHA: `f82d57053f55237ace2515c8b84398923f3df5f7` (PASS 1 discovery was done against this SHA; it is the merge commit of #2143). During the run origin/main advanced to `cdeb2b09ced7340623f6508936a744d99971c91f` (after #2155 and #2157 merged); PASS 3 compared against that SHA.

Primary checkout at baseline time (from `baseline.json`): branch main at `d8f0bdbdde6b8806d09e533e1a627ec0a4bfe76d`, behind origin/main, with a modified `docs/gap-closure/w0-recount.md`, a modified `docs/gap-ledger/PRIORITY_QUEUE.md`, and untracked `erp-gap-analysis/`, `erp-gap-remediation/`, `refs/`. Baseline runs were made in a separate worktree, not the primary checkout.

## Executed evidence (baseline checks)

| Check | Command | Exit | Result |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile` | 0 | PASS (13s) |
| typecheck | `pnpm turbo typecheck --force --concurrency=4` | 0 | PASS 126/126 tasks, 704s |
| lint | `pnpm turbo lint --concurrency=4` | 0 | PASS 0 errors, 67/67 tasks, 181s (warnings present, not counted) |
| web-vitest | `cd apps/web && npx vitest run --maxWorkers=2` | 0 | PASS: 2292 files, 18414 tests passed, 0 failed, 0 skipped, 2299s |
| web-build | `flock /tmp/civitas-webbuild.lock pnpm --filter @civitasone/web build` | 0 | PASS 482s |
| test:contract | `pnpm test:contract` | 0 | PASS 148 passed, 1 skipped, 15s |
| guards-pass | `node scripts/ci/<guard>.mjs` | 0 | PASS: arch, ci-config, contradictory-badge, datatable-render, deployment-declaration, empty-vs-error, evidence-suite-dbs, flaky-skip, jsx-a11y-ratchet, nested-tx, queue-publish-messageid, raw-session-guc, raw-status-leak, stat-tile-literal, tenant-predicate, tenant-router, tenant-table-rls, test-ledger-poison, authz-tenant-scanner, zero-test-module-scanner, bundle-size (re-run with the web build log) |
| guard-money-precision | `node scripts/ci/money-precision-guard.mjs` | 1 | FAIL at baseline |
| guard-sql-injection | `node scripts/ci/sql-injection-guard.mjs` | 1 | FAIL at baseline |
| guard-secret-scanner | `node scripts/ci/secret-scanner.mjs` | 1 | FAIL at baseline |
| guard-package-exports | `node scripts/ci/package-exports-guard.mjs` | 1 | FAIL, environment artifact |
| guard-schema-drift | `node scripts/ci/schema-drift-guard.mjs` | 1 | NOT VERIFIED: needs a DB. It ran against the shared dev Postgres on :5435 and 9 DBs were missing, so the result is invalid |
| guard-tenant-index | `node scripts/ci/tenant-index-guard.mjs` | 1 | NOT VERIFIED: needs a DB. It ran against :5435, 9 DBs were unreachable, and it reported 61 tenant tables with no leading tenant_id index, which is invalid |

Durations and raw exit codes: `~/orch-logs/closure/baseline-results.txt` (install 13s, typecheck 704s, lint 181s, contract 15s, vitest 2299s, webbuild 482s). Logs: `baseline-install.log`, `baseline-typecheck.log`, `baseline-lint.log`, `baseline-contract.log`, `baseline-vitest.log`, `baseline-webbuild.log`, `baseline-guard-*.log`, all under `~/orch-logs/closure/`.

### Guards

Pass (exit 0): arch, ci-config, contradictory-badge, datatable-render, deployment-declaration, empty-vs-error, evidence-suite-dbs, flaky-skip, jsx-a11y-ratchet, nested-tx, queue-publish-messageid, raw-session-guc, raw-status-leak, stat-tile-literal, tenant-predicate, tenant-router, tenant-table-rls, test-ledger-poison, authz-tenant-scanner, zero-test-module-scanner, bundle-size (passed on rerun with the build log: `baseline-guard-bundle-size-guard-rerun.log`).

Fail at baseline (pre-existing, exit 1):
- money-precision-guard: 151 write-path violations
- sql-injection-guard: 24 patterns (10 HIGH / 14 MEDIUM / 13 LOW as recorded; sampled ones were template-literal event names)
- secret-scanner: 71 potential (sampled ones were field names / test strings)
- package-exports-guard: 10 unresolvable entry points (kms, plugin-sdk, security-headers dist unbuilt; environment artifact, no turbo build run)

### Not verified at baseline

- schema-drift-guard and tenant-index-guard: need a bootstrapped DB; they ran against the shared :5435 with 9 DBs missing, so the results (61 new tables reported, etc.) are INVALID and were not used.
- DB-backed service suites were not run at baseline (per-PR CI and per-fix disposable-DB runs cover them).

## Analysis

- At the frozen baseline the web unit suite was green (18414 passed, 0 failed), typecheck, lint, contract and web build were green, so any later red in those areas is attributable to changes made after `f82d57053f55237ace2515c8b84398923f3df5f7`.
- The four failing guards fail on counts of pre-existing findings; they were treated as the baseline reference (classification (a) in `regression-results.md`). No guard baseline file was modified.
- The baseline is not a clean bill of health: the CVE / SCA gate (Next.js) and container scans are red in CI on main, and DB-dependent guards were never evaluated.

## Discovery scope (executed, PASS 1)

PASS 1 produced 39 confirmed LOW defects, 7 BLOCKED_FOR_APPROVAL, 1 rejected (CLOS-S5-01), 0 unverified (`pass1-result.json`). Areas with open in-flight PRs (#2141 #2142 #2145 #2146 #2148 #2149 #2150 and the rescan-fix lanes) were excluded from discovery by the brief.
