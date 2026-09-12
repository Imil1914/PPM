import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "infra/plane/baseline-manifest.json"), "utf8"));
const planeDirectory = resolve(repositoryRoot, manifest.submodulePath);

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  })?.trim();
}

git(["submodule", "sync", "--", manifest.submodulePath]);
git(["submodule", "update", "--init", "--recursive", "--", manifest.submodulePath]);

let upstreamUrl;
try {
  upstreamUrl = execFileSync("git", ["remote", "get-url", "upstream"], {
    cwd: planeDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  execFileSync("git", ["remote", "add", "upstream", manifest.upstreamRepository], {
    cwd: planeDirectory,
    stdio: "inherit",
  });
  upstreamUrl = manifest.upstreamRepository;
}

if (upstreamUrl !== manifest.upstreamRepository) {
  throw new Error(`Plane remote 'upstream' points to ${upstreamUrl}; expected ${manifest.upstreamRepository}`);
}

const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: planeDirectory,
  encoding: "utf8",
}).trim();

if (head !== manifest.commit) {
  throw new Error(`Plane submodule is at ${head}; expected ${manifest.commit}. Refusing to switch a possibly edited checkout.`);
}

console.log(`Plane baseline initialized at ${manifest.releaseTag} (${manifest.commit.slice(0, 12)}).`);
console.log(`Upstream remote: ${manifest.upstreamRepository}`);
