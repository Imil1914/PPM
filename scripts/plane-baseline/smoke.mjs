import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "infra/plane/baseline-manifest.json"), "utf8"));
const statePath = resolve(repositoryRoot, "infra/plane/.runtime/smoke-state.json");
const baseUrl = (process.env.PLANE_BASE_URL || manifest.runtime.httpUrl).replace(/\/$/, "");
const mode = process.argv.includes("--verify-state") ? "verify" : "bootstrap";

function splitSetCookie(header) {
  return header ? header.split(/,(?=\s*[^;,=]+=[^;,]+)/g) : [];
}

class Client {
  cookies = new Map();
  csrfToken = "";

  captureCookies(headers) {
    const setCookies = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookie(headers.get("set-cookie"));
    for (const value of setCookies) {
      const [pair, ...attributes] = value.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const cookieValue = pair.slice(separator + 1).trim();
      const deleted = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute)) || cookieValue === "";
      if (deleted) this.cookies.delete(name);
      else this.cookies.set(name, cookieValue);
    }
  }

  async request(path, options = {}) {
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
    const method = options.method || "GET";
    const headers = new Headers({ Accept: "application/json, text/plain, */*", ...options.headers });
    if (this.cookies.size > 0) {
      headers.set("Cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    if (!/^(GET|HEAD|OPTIONS)$/.test(method) && this.csrfToken) headers.set("X-CSRFToken", this.csrfToken);

    let body;
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(options.form);
    }

    const response = await fetch(url, { method, headers, body, redirect: options.redirect || "manual" });
    this.captureCookies(response.headers);
    const raw = await response.text();
    let data = raw;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      // Redirects and proxy errors may be HTML; status and a short excerpt are enough for diagnostics.
    }

    const expected = options.expected || [200];
    if (!expected.includes(response.status)) {
      const excerpt = typeof data === "string" ? data.replace(/\s+/g, " ").slice(0, 240) : JSON.stringify(data).slice(0, 240);
      throw new Error(`${method} ${path} returned ${response.status}; expected ${expected.join("/")}. ${excerpt}`);
    }
    return { data, headers: response.headers, status: response.status };
  }

  async csrf() {
    const response = await this.request("/auth/get-csrf-token/");
    if (!response.data?.csrf_token) throw new Error("Plane did not return a CSRF token.");
    this.csrfToken = response.data.csrf_token;
  }
}

async function waitForPlane(timeoutMs = 600_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/instances/`, { redirect: "manual" });
      if (response.status === 200) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  }
  throw new Error(`Plane did not become ready within ${timeoutMs / 1000}s: ${lastError?.message || "unknown error"}`);
}

function randomPassword() {
  return `Ppm!${randomBytes(20).toString("base64url")}9a`;
}

async function signIn(client, email, password) {
  await client.csrf();
  const response = await client.request("/auth/sign-in/", {
    method: "POST",
    form: { email, password },
    expected: [301, 302, 303],
  });
  const location = response.headers.get("location") || "";
  if (/error_code|error_message/i.test(location)) throw new Error("Plane rejected the smoke user sign-in.");
  if (!client.cookies.has("session-id")) throw new Error("Plane sign-in did not create an application session.");
}

async function verifyEntities(client, state) {
  const workspace = await client.request(`/api/workspaces/${state.workspaceSlug}/`);
  if (workspace.data?.id !== state.workspaceId) throw new Error("Workspace identity changed after authentication/restart.");
  const project = await client.request(`/api/workspaces/${state.workspaceSlug}/projects/${state.projectId}/`);
  if (project.data?.id !== state.projectId) throw new Error("Project could not be read after authentication/restart.");
  const issue = await client.request(`/api/workspaces/${state.workspaceSlug}/projects/${state.projectId}/issues/${state.issueId}/`);
  if (issue.data?.id !== state.issueId || Number(issue.data?.attachment_count || 0) < 1) {
    throw new Error("Work Item or its attachment did not survive authentication/restart.");
  }
  const page = await client.request(`/api/workspaces/${state.workspaceSlug}/projects/${state.projectId}/pages/${state.pageId}/?track_visit=false`);
  if (page.data?.id !== state.pageId) throw new Error("Page could not be read after authentication/restart.");
  const asset = await client.request(
    `/api/assets/v2/workspaces/${state.workspaceSlug}/projects/${state.projectId}/${state.assetId}/`,
    { expected: [301, 302, 303] }
  );
  if (!asset.headers.get("location")) throw new Error("Attachment download URL was not returned.");
}

async function bootstrap() {
  if (existsSync(statePath)) throw new Error("Smoke state already exists. Refusing to create duplicate baseline data.");
  const instanceClient = new Client();
  const instance = await instanceClient.request("/api/instances/");
  if (instance.data?.is_setup_done) throw new Error("Plane instance is already configured; bootstrap smoke requires an empty test instance.");

  await instanceClient.csrf();
  const adminSignup = await instanceClient.request("/api/instances/admins/sign-up/", {
    method: "POST",
    form: {
      email: `ppm-admin-${Date.now()}@example.test`,
      password: randomPassword(),
      first_name: "PPM",
      last_name: "Baseline",
      company_name: "PPM Baseline",
      // Django's BooleanField accepts the canonical form value "False".
      is_telemetry_enabled: "False",
    },
    expected: [301, 302, 303],
  });
  if (/error_code|error_message/i.test(adminSignup.headers.get("location") || "")) {
    throw new Error("Plane rejected initial instance setup.");
  }

  const email = `ppm-smoke-${Date.now()}@example.test`;
  const password = randomPassword();
  const client = new Client();
  await client.csrf();
  const signup = await client.request("/auth/sign-up/", {
    method: "POST",
    form: { email, password },
    expected: [301, 302, 303],
  });
  if (/error_code|error_message/i.test(signup.headers.get("location") || "")) throw new Error("Plane rejected user registration.");
  if (!client.cookies.has("session-id")) throw new Error("Plane registration did not create an application session.");

  const suffix = Date.now().toString(36);
  const workspaceSlug = `ppm-baseline-${suffix}`;
  const workspace = await client.request("/api/workspaces/", {
    method: "POST",
    json: { name: "PPM Baseline", slug: workspaceSlug },
    expected: [201],
  });
  const project = await client.request(`/api/workspaces/${workspaceSlug}/projects/`, {
    method: "POST",
    json: { name: "Baseline Project", identifier: "BASE", network: 0 },
    expected: [201],
  });
  const issue = await client.request(`/api/workspaces/${workspaceSlug}/projects/${project.data.id}/issues/`, {
    method: "POST",
    json: { name: "Baseline Work Item", priority: "none" },
    expected: [201],
  });
  const page = await client.request(`/api/workspaces/${workspaceSlug}/projects/${project.data.id}/pages/`, {
    method: "POST",
    json: { name: "Baseline Page", access: 0, description_html: "<p>PPM baseline</p>" },
    expected: [201],
  });

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8Z8AAAAASUVORK5CYII=", "base64");
  const asset = await client.request(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${project.data.id}/`, {
    method: "POST",
    json: {
      name: "baseline.png",
      type: "image/png",
      size: png.length,
      entity_type: "ISSUE_ATTACHMENT",
      entity_identifier: issue.data.id,
    },
  });
  if (!asset.data?.upload_data?.url || !asset.data?.asset_id) throw new Error("Plane did not return attachment upload data.");

  const uploadForm = new FormData();
  for (const [key, value] of Object.entries(asset.data.upload_data.fields || {})) uploadForm.append(key, String(value));
  uploadForm.append("file", new Blob([png], { type: "image/png" }), "baseline.png");
  const uploadResponse = await fetch(asset.data.upload_data.url, { method: "POST", body: uploadForm, redirect: "manual" });
  if (![200, 201, 204].includes(uploadResponse.status)) throw new Error(`Attachment storage upload returned ${uploadResponse.status}.`);
  await client.request(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${project.data.id}/${asset.data.asset_id}/`, {
    method: "PATCH",
    json: {},
    expected: [204],
  });

  const state = {
    email,
    password,
    workspaceSlug,
    workspaceId: workspace.data.id,
    projectId: project.data.id,
    issueId: issue.data.id,
    pageId: page.data.id,
    assetId: asset.data.asset_id,
  };
  await verifyEntities(client, state);
  // Django rotates the CSRF secret during signup/login; refresh it before the
  // plain Django sign-out view, which enforces CSRF independently of DRF.
  await client.csrf();
  await client.request("/auth/sign-out/", { method: "POST", form: {}, expected: [301, 302, 303] });
  if (client.cookies.has("session-id")) throw new Error("Plane logout did not clear the application session.");
  await signIn(client, email, password);
  await verifyEntities(client, state);

  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log("Plane golden smoke passed through registration, workspace, project, Work Item, Page, attachment, logout and login.");
  console.log("Smoke credentials were stored only in the ignored runtime directory and were not printed.");
}

async function verifyAfterRestart() {
  if (!existsSync(statePath)) throw new Error("Smoke state is missing; run npm run plane:smoke before restart verification.");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const client = new Client();
  await signIn(client, state.email, state.password);
  await verifyEntities(client, state);
  console.log("Plane restart smoke passed: workspace, project, Work Item, Page and attachment remain readable.");
}

await waitForPlane();
if (mode === "bootstrap") await bootstrap();
else await verifyAfterRestart();
