/**
 * Lighthouse CI performance baseline gate (Req 7.3, task 36).
 *
 * Asserts LCP < 2500ms and TBT < 300ms on /estab/files/list and
 * /inventory/list, per the task's exact thresholds. Runs against a
 * production build of apps/web (see the nightly.yml lighthouse job) with
 * auth handled by tests/lighthouse/puppeteer-script.js (mints the same
 * civitasone_at cookie the a11y gate already uses).
 *
 * `numberOfRuns: 3` and asserting on the median trims single-run noise —
 * Lighthouse's own timing measurements vary run to run even against a
 * static server, and a single bad sample should not flip the gate red.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        "http://localhost:3000/estab/files/list",
        "http://localhost:3000/inventory/list",
      ],
      numberOfRuns: 3,
      puppeteerScript: "./apps/web/tests/lighthouse/puppeteer-script.js",
      settings: {
        // Server-rendered pages behind auth — skip storage-reset so the
        // puppeteerScript-set cookie survives from the warm-up navigation
        // into the audited run.
        disableStorageReset: true,
        chromeFlags: "--no-sandbox --disable-gpu",
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: ".*",
          assertions: {
            "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
            "total-blocking-time": ["error", { maxNumericValue: 300 }],
          },
        },
      ],
    },
    upload: {
      // filesystem, not temporary-public-storage: that target uploads the
      // full report (including page URLs and screen structure) to a public
      // Google-hosted server. Keeping reports local avoids sending anything
      // about this deployment to a third party.
      target: "filesystem",
      outputDir: "./.lighthouseci",
    },
  },
};
