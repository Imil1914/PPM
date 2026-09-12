import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "infra/plane/baseline-manifest.json"), "utf8"));
const environmentPath = resolve(repositoryRoot, manifest.runtime.environmentFile);
const environmentText = readFileSync(environmentPath, "utf8");
const secrets = [];

for (const line of environmentText.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match || match[2].length < 8) continue;
  if (/(PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL|AMQP_URL)/.test(match[1])) {
    secrets.push([match[1], match[2]]);
  }
}

const result = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    manifest.runtime.environmentFile,
    "-f",
    manifest.runtime.composeFile,
    "-f",
    manifest.runtime.composeCompatibilityFile,
    "logs",
    "--no-color",
    "--tail=250",
    "api",
    "migrator",
    "worker",
  ],
  { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
);

let output = `${result.stdout || ""}${result.stderr || ""}`;
for (const [key, value] of secrets) output = output.replaceAll(value, `<redacted:${key}>`);
process.stdout.write(output || "No service logs were available.\n");
