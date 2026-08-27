#!/usr/bin/env node
// TEMPORARY diagnostic for the Accessibility/E2E CI webServer timeout
// investigation. Not meant to be merged — remove before this PR ships.
import { execSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import http from "node:http";
import { readFileSync } from "node:fs";

function run(label, cmd) {
  console.log(`\n### ${label} ###`);
  try {
    console.log(execSync(cmd, { encoding: "utf8", timeout: 8000 }));
  } catch (e) {
    console.log(`(command failed/errored: ${e.message})`);
  }
}

function httpProbe(label, host) {
  return new Promise((resolve) => {
    console.log(`\n### http.get ${host} ###`);
    const start = Date.now();
    const req = http.get({ host, port: 3000, path: "/auth/login", timeout: 5000 }, (res) => {
      console.log(`STATUS ${res.statusCode} after ${Date.now() - start}ms`);
      res.resume();
      res.on("end", resolve);
    });
    req.on("timeout", () => {
      console.log(`TIMEOUT after ${Date.now() - start}ms (no connection/response within 5000ms)`);
      req.destroy();
      resolve();
    });
    req.on("error", (e) => {
      console.log(`ERROR after ${Date.now() - start}ms: ${e.code ?? ""} ${e.message}`);
      resolve();
    });
  });
}

run("ss -tlnp", "ss -tlnp || netstat -tlnp");
run("ps aux | grep -i next", "ps aux | grep -i next");

console.log("\n### /etc/hosts ###");
try {
  console.log(readFileSync("/etc/hosts", "utf8"));
} catch (e) {
  console.log(`(could not read: ${e.message})`);
}

console.log("\n### env proxy vars ###");
const proxyVars = Object.entries(process.env).filter(([k]) => /proxy/i.test(k));
console.log(proxyVars.length ? proxyVars.map(([k, v]) => `${k}=${v}`).join("\n") : "(none set)");

console.log("\n### dns.lookup('localhost', { all: true }) ###");
try {
  console.log(JSON.stringify(await lookup("localhost", { all: true })));
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

run("web-server.log (tail)", "tail -n 100 web-server.log 2>&1 || echo none");

await httpProbe("127.0.0.1 (IPv4 literal)", "127.0.0.1");
await httpProbe("::1 (IPv6 literal)", "::1");
await httpProbe("localhost (resolved by Node)", "localhost");

run("curl -v 127.0.0.1:3000", "curl -sv --max-time 5 http://127.0.0.1:3000/auth/login -o /dev/null 2>&1");
run("curl -v localhost:3000", "curl -sv --max-time 5 http://localhost:3000/auth/login -o /dev/null 2>&1");

console.log("\n### probe complete ###");
