import fs from "node:fs";
const j = JSON.parse(fs.readFileSync("reports/mutation/mutation-report.json", "utf8"));
const st = {};
const rows = [];
for (const [p, f] of Object.entries(j.files ?? {})) {
  const c = {};
  for (const m of f.mutants) {
    st[m.status] = (st[m.status] ?? 0) + 1;
    c[m.status] = (c[m.status] ?? 0) + 1;
  }
  const killed = c.Killed ?? 0;
  const survived = c.Survived ?? 0;
  const noCov = c.NoCoverage ?? 0;
  const timeout = c.Timeout ?? 0;
  const total = f.mutants.length;
  // Stryker's mutation score = (killed + timeout) / (total - ignored)
  const score = total ? (((killed + timeout) / total) * 100) : 0;
  rows.push({ file: p.split("/").slice(-3).join("/"), score, killed, survived, noCov, total });
}
rows.sort((a, b) => a.score - b.score);
console.log("status totals:", JSON.stringify(st));
const T = rows.reduce((a, r) => ({ k: a.k + r.killed, s: a.s + r.survived, n: a.n + r.noCov, t: a.t + r.total }), { k: 0, s: 0, n: 0, t: 0 });
console.log(`overall score = ${(((T.k) / T.t) * 100).toFixed(2)}%  (killed ${T.k} / ${T.t})  survived=${T.s} noCoverage=${T.n}`);
console.log("");
console.log("file".padEnd(34) + "score".padStart(8) + "killed".padStart(8) + "survd".padStart(7) + "noCov".padStart(7));
for (const r of rows) {
  console.log(
    r.file.padEnd(34) +
    (r.score.toFixed(1) + "%").padStart(8) +
    String(r.killed).padStart(8) +
    String(r.survived).padStart(7) +
    String(r.noCov).padStart(7) +
    (r.score < 70 ? "   below 70" : ""),
  );
}
