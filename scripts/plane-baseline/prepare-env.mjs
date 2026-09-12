import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "infra/plane/baseline-manifest.json"), "utf8"));
const sourcePath = resolve(repositoryRoot, manifest.runtime.environmentTemplate);
const targetPath = resolve(repositoryRoot, manifest.runtime.environmentFile);
const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");

function parseEnvironment(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function validate(text) {
  const values = parseEnvironment(text);
  const errors = [];
  const required = [
    "APP_DOMAIN",
    "APP_RELEASE",
    "LISTEN_HTTP_PORT",
    "LISTEN_HTTPS_PORT",
    "WEB_URL",
    "CORS_ALLOWED_ORIGINS",
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "RABBITMQ_PASSWORD",
    "AMQP_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "SECRET_KEY",
    "LIVE_SERVER_SECRET_KEY",
  ];

  for (const key of required) {
    if (!values.get(key)) errors.push(`${key} is missing or empty.`);
  }
  if (values.get("APP_RELEASE") !== manifest.runtime.applicationRelease) {
    errors.push(`APP_RELEASE must be ${manifest.runtime.applicationRelease}.`);
  }
  if (values.get("LISTEN_HTTP_PORT") !== "8080" || values.get("LISTEN_HTTPS_PORT") !== "8443") {
    errors.push("Baseline ports must be 8080/8443.");
  }
  for (const key of ["POSTGRES_PASSWORD", "RABBITMQ_PASSWORD", "AWS_SECRET_ACCESS_KEY", "SECRET_KEY", "LIVE_SERVER_SECRET_KEY"]) {
    const value = values.get(key) || "";
    if (/^(plane|secret-key|change-this-key-on-deployment)$/i.test(value) || value.length < 24) {
      errors.push(`${key} still contains a default or weak value.`);
    }
  }
  return errors;
}

if (checkOnly) {
  if (!existsSync(targetPath)) throw new Error(`Missing ${manifest.runtime.environmentFile}; run npm run plane:env first.`);
  const errors = validate(readFileSync(targetPath, "utf8"));
  if (errors.length > 0) throw new Error(`Plane environment is invalid:\n- ${errors.join("\n- ")}`);
  console.log(`Plane environment verified at ${manifest.runtime.environmentFile}; secret values were not printed.`);
  process.exit(0);
}

if (!existsSync(sourcePath)) throw new Error(`Official Plane environment template is missing: ${manifest.runtime.environmentTemplate}`);
if (existsSync(targetPath) && !force) {
  throw new Error(`${manifest.runtime.environmentFile} already exists. Use --check, or --force to replace it explicitly.`);
}

const postgresPassword = randomBytes(24).toString("hex");
const rabbitPassword = randomBytes(24).toString("hex");
const accessKey = `ppm${randomBytes(10).toString("hex")}`;
const secretAccessKey = randomBytes(32).toString("hex");
const replacements = new Map([
  ["APP_DOMAIN", "localhost"],
  ["APP_RELEASE", manifest.runtime.applicationRelease],
  ["LISTEN_HTTP_PORT", "8080"],
  ["LISTEN_HTTPS_PORT", "8443"],
  ["WEB_URL", "http://localhost:8080"],
  ["CORS_ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"],
  ["POSTGRES_PASSWORD", postgresPassword],
  ["DATABASE_URL", `postgresql://plane:${postgresPassword}@plane-db/plane`],
  ["RABBITMQ_PASSWORD", rabbitPassword],
  ["AMQP_URL", `amqp://plane:${rabbitPassword}@plane-mq:5672/plane`],
  ["AWS_ACCESS_KEY_ID", accessKey],
  ["AWS_SECRET_ACCESS_KEY", secretAccessKey],
  ["SECRET_KEY", randomBytes(48).toString("hex")],
  ["LIVE_SERVER_SECRET_KEY", randomBytes(48).toString("hex")],
]);

let output = readFileSync(sourcePath, "utf8");
for (const [key, value] of replacements) {
  const expression = new RegExp(`^${key}=.*$`, "m");
  if (!expression.test(output)) throw new Error(`Official template no longer contains ${key}.`);
  output = output.replace(expression, `${key}=${value}`);
}

const errors = validate(output);
if (errors.length > 0) throw new Error(`Refusing to write invalid Plane environment:\n- ${errors.join("\n- ")}`);

mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, output.replace(/\r?\n/g, "\n"), { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(targetPath, 0o600);
} catch {
  // Windows does not implement POSIX mode bits; Git ignore remains the protection boundary.
}
console.log(`Created ${manifest.runtime.environmentFile} from the official Plane template.`);
console.log(`APP_RELEASE is pinned to ${manifest.runtime.applicationRelease}; generated secrets were not printed.`);
