import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const manifestPath = resolve(repositoryRoot, "infra/plane/baseline-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const planeDirectory = resolve(repositoryRoot, manifest.submodulePath);
const expectedCommit = manifest.integrationCommit || manifest.commit;
const patches = Array.isArray(manifest.ppmPatches) ? manifest.ppmPatches : [];
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function git(directory, ...args) {
  try {
    return execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    failures.push(`git ${args.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
    return "";
  }
}

function gitSucceeds(directory, ...args) {
  try {
    execFileSync("git", args, {
      cwd: directory,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

check(manifest.schemaVersion === 2, "Unsupported baseline manifest schema.");
check(manifest.version === "1.4.2", "Plane version is not pinned to 1.4.2.");
check(manifest.releaseTag === `v${manifest.version}`, "Release tag and version disagree.");
check(/^[0-9a-f]{40}$/.test(manifest.commit), "Plane commit is not a full SHA-1.");
check(/^[0-9a-f]{40}$/.test(expectedCommit), "Plane integration commit is not a full SHA-1.");
check(patches.length > 0, "PPM patch chain is missing.");
check(patches.at(-1)?.commit === expectedCommit, "Last PPM patch is not the pinned integration commit.");
check(new Set(patches.map((patch) => patch.taskId)).size === patches.length, "PPM patch task IDs must be unique.");
check(existsSync(planeDirectory), "Plane submodule directory is missing; run npm run plane:bootstrap.");

if (existsSync(planeDirectory)) {
  const head = git(planeDirectory, "rev-parse", "HEAD");
  const tagCommit = git(planeDirectory, "rev-list", "-n", "1", manifest.releaseTag);
  const originUrl = git(planeDirectory, "remote", "get-url", "origin");
  const status = git(planeDirectory, "status", "--porcelain", "--untracked-files=all");
  check(head === expectedCommit, `Submodule HEAD is ${head}; expected ${expectedCommit}.`);
  check(tagCommit === manifest.commit, `${manifest.releaseTag} resolves to ${tagCommit}; expected ${manifest.commit}.`);
  check(originUrl === manifest.forkRepository, `Plane origin is ${originUrl}; expected ${manifest.forkRepository}.`);
  check(status === "", "Plane submodule contains tracked or untracked changes.");
  check(
    gitSucceeds(planeDirectory, "merge-base", "--is-ancestor", manifest.commit, expectedCommit),
    "Pinned Plane integration is not descended from the immutable upstream baseline."
  );

  for (const patch of patches) {
    check(/^I[0-9]+\.[0-9]+$/.test(patch.taskId), `Invalid PPM patch task ID: ${patch.taskId}.`);
    check(/^[0-9a-f]{40}$/.test(patch.commit), `PPM patch ${patch.taskId} does not use a full commit SHA-1.`);
    check(
      gitSucceeds(planeDirectory, "merge-base", "--is-ancestor", manifest.commit, patch.commit),
      `PPM patch ${patch.taskId} is not descended from the baseline.`
    );
    check(
      gitSucceeds(planeDirectory, "merge-base", "--is-ancestor", patch.commit, expectedCommit),
      `PPM patch ${patch.taskId} is not contained in the pinned integration.`
    );
  }

  const packageJson = JSON.parse(readFileSync(resolve(planeDirectory, "package.json"), "utf8"));
  check(packageJson.version === manifest.version, "Plane package.json version disagrees with manifest.");
  check(packageJson.license === manifest.license.packageDeclaration, "Plane package license disagrees with manifest.");

  for (const [relativePath, expectedHash] of Object.entries(manifest.integrity)) {
    const absolutePath = resolve(planeDirectory, relativePath);
    if (!existsSync(absolutePath)) {
      failures.push(`Integrity target is missing: ${relativePath}`);
      continue;
    }
    let canonicalContents;
    try {
      canonicalContents = execFileSync("git", ["show", `${manifest.commit}:${relativePath}`], {
        cwd: planeDirectory,
        encoding: null,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      failures.push(`Cannot read ${relativePath} from pinned commit: ${error.stderr?.toString().trim() || error.message}`);
      continue;
    }
    const actualHash = createHash("sha256").update(canonicalContents).digest("hex");
    check(actualHash === expectedHash, `SHA-256 mismatch for ${relativePath}.`);
  }
}

const modulesFile = resolve(repositoryRoot, ".gitmodules");
check(existsSync(modulesFile), ".gitmodules is missing.");
if (existsSync(modulesFile)) {
  const configuredPath = git(repositoryRoot, "config", "-f", ".gitmodules", "--get", "submodule.plane-fork.path");
  const configuredUrl = git(repositoryRoot, "config", "-f", ".gitmodules", "--get", "submodule.plane-fork.url");
  const configuredBranch = git(repositoryRoot, "config", "-f", ".gitmodules", "--get", "submodule.plane-fork.branch");
  check(configuredPath === manifest.submodulePath, "Submodule path disagrees with manifest.");
  check(configuredUrl === manifest.forkRepository, "Submodule URL disagrees with manifest.");
  check(configuredBranch === manifest.integrationBranch, "Submodule branch disagrees with manifest.");
}

if (failures.length > 0) {
  console.error("Plane baseline verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Plane baseline verified: ${manifest.releaseTag} @ ${manifest.commit}`);
console.log(`Plane integration verified: ${expectedCommit} (${patches.length} PPM patch).`);
console.log(`${Object.keys(manifest.integrity).length} immutable baseline integrity checks passed.`);
