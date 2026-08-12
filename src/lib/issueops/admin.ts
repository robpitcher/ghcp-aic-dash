import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dump } from "js-yaml";
import {
  BUDGET_ADMIN_REVIEW_LABEL,
  BUDGET_APPLIED_LABEL,
  BUDGET_APPROVAL_LABEL,
  BUDGET_AUTO_ELIGIBLE_LABEL,
  BUDGET_INVALID_LABEL,
  BUDGET_NEEDS_APPROVAL_LABEL,
  BUDGET_REQUEST_LABEL,
} from "./index";
import {
  DEFAULT_ISSUEOPS_CONFIG_PATH,
  ISSUEOPS_CONFIG_SCHEMA,
  parseIssueOpsConfig,
  type IssueOpsConfig,
} from "./config";

const ACTION_PATH = ".github/actions/budget-issueops";
const ISSUE_TEMPLATE_SOURCE_PATH =
  "templates/issueops/ai-credit-budget-request.md";
const ISSUE_TEMPLATE_DESTINATION_PATH =
  ".github/ISSUE_TEMPLATE/ai-credit-budget-request.md";
const MANAGED_FILES = [
  ".github/workflows/budget-request-triage.yml",
  ".github/workflows/budget-request-apply.yml",
  ".github/workflows/budget-request-rollback.yml",
  ISSUE_TEMPLATE_DESTINATION_PATH,
] as const;
const FILES_BY_LEVEL: Record<
  IssueOpsOperatingLevel,
  readonly (typeof MANAGED_FILES)[number][]
> = {
  triage: [
    ".github/workflows/budget-request-triage.yml",
    ".github/ISSUE_TEMPLATE/ai-credit-budget-request.md",
  ],
  "dry-run": MANAGED_FILES,
  "protected-writes": MANAGED_FILES,
};

const REQUIRED_LABELS = [
  { name: BUDGET_REQUEST_LABEL, color: "0969da" },
  { name: BUDGET_INVALID_LABEL, color: "d1242f" },
  { name: BUDGET_NEEDS_APPROVAL_LABEL, color: "bf8700" },
  { name: BUDGET_AUTO_ELIGIBLE_LABEL, color: "1a7f37" },
  { name: BUDGET_APPROVAL_LABEL, color: "8250df" },
  { name: BUDGET_APPLIED_LABEL, color: "1a7f37" },
  { name: BUDGET_ADMIN_REVIEW_LABEL, color: "d1242f" },
] as const;

function normalizeText(source: string): string {
  return source.replace(/\r\n/g, "\n");
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourcePathFor(destinationPath: string): string {
  return destinationPath === ISSUE_TEMPLATE_DESTINATION_PATH
    ? ISSUE_TEMPLATE_SOURCE_PATH
    : destinationPath;
}

export type IssueOpsOperatingLevel =
  | "triage"
  | "dry-run"
  | "protected-writes";

export interface GhApiClient {
  request<T>(
    path: string,
    options?: {
      method?: "GET" | "POST" | "PUT" | "PATCH";
      body?: Record<string, unknown>;
      allowNotFound?: boolean;
    },
  ): Promise<T | undefined>;
  run(args: string[], input?: string): Promise<string>;
}

export class GhCliClient implements GhApiClient {
  async run(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("gh", args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(
              `gh ${args[0] ?? ""} failed (${code ?? "unknown"}): ${stderr.trim().slice(0, 500)}`,
            ),
          );
        }
      });
      child.stdin.end(input);
    });
  }

  async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "PATCH";
      body?: Record<string, unknown>;
      allowNotFound?: boolean;
    } = {},
  ): Promise<T | undefined> {
    const args = ["api", path, "--method", options.method ?? "GET"];
    const input = options.body ? JSON.stringify(options.body) : undefined;
    if (input) {
      args.push("--input", "-");
    }
    try {
      const output = await this.run(args, input);
      return output ? (JSON.parse(output) as T) : undefined;
    } catch (error) {
      if (
        options.allowNotFound &&
        error instanceof Error &&
        error.message.includes("HTTP 404")
      ) {
        return undefined;
      }
      throw error;
    }
  }
}

interface RepositoryContent {
  content: string;
  encoding: string;
  sha: string;
}

export interface IssueOpsSetupOptions {
  repository: string;
  actionRepository: string;
  level: IssueOpsOperatingLevel;
  actionRef?: string;
  enterpriseSlug?: string | null;
  maxDeltaCredits?: number;
  maxTotalCredits?: number;
  protectedBranchesOnly?: boolean;
  apply?: boolean;
  client?: GhApiClient;
  readText?: (path: string, encoding: "utf8") => Promise<string>;
  log?: (message: string) => void;
}

export interface IssueOpsSetupResult {
  actionSha: string;
  changes: string[];
  applied: boolean;
}

function validateRepository(repository: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Repository must use exact OWNER/REPO syntax.");
  }
}

function validateLimit(value: number | undefined, name: string): number {
  const normalized = value ?? 0;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return normalized;
}

function buildConfig(options: IssueOpsSetupOptions): IssueOpsConfig {
  return {
    schema: ISSUEOPS_CONFIG_SCHEMA,
    enterprise_slug: options.enterpriseSlug ?? null,
    auto_approval: {
      max_delta_credits: validateLimit(
        options.maxDeltaCredits,
        "maxDeltaCredits",
      ),
      max_total_credits: validateLimit(
        options.maxTotalCredits,
        "maxTotalCredits",
      ),
    },
  };
}

async function resolveActionSha(
  client: GhApiClient,
  actionRepository: string,
  ref: string,
): Promise<string> {
  const commit = await client.request<{ sha?: string }>(
    `repos/${actionRepository}/commits/${encodeURIComponent(ref)}`,
  );
  if (!commit?.sha || !/^[a-f0-9]{40}$/.test(commit.sha)) {
    throw new Error(`Unable to resolve action ref "${ref}" to a commit SHA.`);
  }
  return commit.sha;
}

async function loadManagedFiles(
  actionRepository: string,
  actionSha: string,
  actionRef: string,
  config: IssueOpsConfig,
  level: IssueOpsOperatingLevel,
  readText: (path: string, encoding: "utf8") => Promise<string>,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const path of FILES_BY_LEVEL[level]) {
    let source = normalizeText(await readText(sourcePathFor(path), "utf8"));
    if (path.includes("/workflows/")) {
      source = source.replaceAll(
        "uses: ./.github/actions/budget-issueops",
        `uses: ${actionRepository}/${ACTION_PATH}@${actionSha} # ${actionRef}`,
      );
    }
    files.set(path, source);
  }
  files.set(
    DEFAULT_ISSUEOPS_CONFIG_PATH,
    normalizeText(
      dump(config, {
        noRefs: true,
        lineWidth: -1,
        sortKeys: false,
        quotingType: '"',
        forceQuotes: false,
      }),
    ),
  );
  return files;
}

async function getContent(
  client: GhApiClient,
  repository: string,
  path: string,
): Promise<{ text: string; sha: string } | undefined> {
  const content = await client.request<RepositoryContent>(
    `repos/${repository}/contents/${path}`,
    { allowNotFound: true },
  );
  if (!content) {
    return undefined;
  }
  if (content.encoding !== "base64") {
    throw new Error(`Unsupported content encoding for ${path}.`);
  }
  return {
    text: normalizeText(
      Buffer.from(content.content, "base64").toString("utf8"),
    ),
    sha: content.sha,
  };
}

async function putContent(
  client: GhApiClient,
  repository: string,
  path: string,
  text: string,
  sha?: string,
): Promise<void> {
  await client.request(`repos/${repository}/contents/${path}`, {
    method: "PUT",
    body: {
      message: `Configure Budget Request IssueOps: ${path}`,
      content: Buffer.from(normalizeText(text), "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    },
  });
}

export async function setupIssueOps(
  options: IssueOpsSetupOptions,
): Promise<IssueOpsSetupResult> {
  validateRepository(options.repository);
  validateRepository(options.actionRepository);
  const client = options.client ?? new GhCliClient();
  const log = options.log ?? console.log;
  const readText = options.readText ?? readFile;
  const actionRef = options.actionRef ?? "main";
  const actionSha = await resolveActionSha(
    client,
    options.actionRepository,
    actionRef,
  );
  const config = buildConfig(options);
  const files = await loadManagedFiles(
    options.actionRepository,
    actionSha,
    actionRef,
    config,
    options.level,
    readText,
  );
  const changes: string[] = [];
  const pendingFiles: Array<{
    path: string;
    text: string;
    sha?: string;
  }> = [];

  for (const [path, text] of files) {
    const current = await getContent(client, options.repository, path);
    if (current?.text === text) {
      continue;
    }
    changes.push(`${current ? "update" : "create"} ${path}`);
    pendingFiles.push({ path, text, sha: current?.sha });
  }

  const labels =
    (await client.request<Array<{ name: string }>>(
      `repos/${options.repository}/labels?per_page=100`,
    )) ?? [];
  const labelNames = new Set(labels.map((label) => label.name));
  for (const label of REQUIRED_LABELS) {
    if (!labelNames.has(label.name)) {
      changes.push(`create label ${label.name}`);
    }
  }

  if (options.level !== "triage") {
    changes.push("set BUDGET_WRITE_ENABLED=false");
  }
  if (options.level === "protected-writes") {
    changes.push("ensure environment budget-approver");
  }

  for (const change of changes) {
    log(`${options.apply ? "APPLY" : "PLAN"} ${change}`);
  }
  if (!options.apply) {
    return { actionSha, changes, applied: false };
  }

  for (const file of pendingFiles) {
    await putContent(
      client,
      options.repository,
      file.path,
      file.text,
      file.sha,
    );
  }
  for (const label of REQUIRED_LABELS) {
    if (!labelNames.has(label.name)) {
      await client.request(`repos/${options.repository}/labels`, {
        method: "POST",
        body: {
          name: label.name,
          color: label.color,
          description: `AI credit budget operations: ${label.name}`,
        },
      });
    }
  }
  if (options.level !== "triage") {
    await client.run([
      "variable",
      "set",
      "BUDGET_WRITE_ENABLED",
      "--body",
      "false",
      "--repo",
      options.repository,
    ]);
  }
  if (options.level === "protected-writes") {
    await client.request(
      `repos/${options.repository}/environments/budget-approver`,
      {
        method: "PUT",
        body: {
          deployment_branch_policy: {
            protected_branches: options.protectedBranchesOnly ?? true,
            custom_branch_policies: false,
          },
        },
      },
    );
  }

  return { actionSha, changes, applied: true };
}

export type DoctorStatus = "pass" | "warning" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface IssueOpsDoctorOptions {
  repository: string;
  actionRepository: string;
  level: IssueOpsOperatingLevel;
  client?: GhApiClient;
}

export async function doctorIssueOps(
  options: IssueOpsDoctorOptions,
): Promise<DoctorCheck[]> {
  validateRepository(options.repository);
  validateRepository(options.actionRepository);
  const client = options.client ?? new GhCliClient();
  const checks: DoctorCheck[] = [];

  try {
    await client.request(
      `repos/${options.repository}/actions/permissions`,
    );
    checks.push({
      name: "actions",
      status: "pass",
      detail: "GitHub Actions permissions are readable.",
    });
  } catch (error) {
    checks.push({
      name: "actions",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  for (const path of [
    ...FILES_BY_LEVEL[options.level],
    DEFAULT_ISSUEOPS_CONFIG_PATH,
  ]) {
    const content = await getContent(client, options.repository, path);
    checks.push({
      name: path,
      status: content ? "pass" : "fail",
      detail: content ? "Installed." : "Missing.",
    });
    if (content && path.includes("/workflows/")) {
      const workflowName = path.split("/").at(-1);
      const workflow = workflowName
        ? await client.request(
            `repos/${options.repository}/actions/workflows/${workflowName}`,
            { allowNotFound: true },
          )
        : undefined;
      checks.push({
        name: `${path} availability`,
        status: workflow ? "pass" : "fail",
        detail: workflow
          ? "Workflow is available to GitHub Actions."
          : "Workflow is not available on the default branch.",
      });
    }
    if (content && path.includes("/workflows/")) {
      const remoteAction = new RegExp(
        `${escapeRegExp(options.actionRepository)}/${escapeRegExp(ACTION_PATH)}@[a-f0-9]{40}`,
      );
      checks.push({
        name: `${path} action pin`,
        status: remoteAction.test(content.text) ? "pass" : "fail",
        detail: remoteAction.test(content.text)
          ? "Uses an immutable action commit SHA."
          : "Action reference is missing or not pinned to a commit SHA.",
      });
    }
    if (content && path === DEFAULT_ISSUEOPS_CONFIG_PATH) {
      const parsed = parseIssueOpsConfig(content.text);
      checks.push({
        name: "IssueOps configuration",
        status: parsed.ok ? "pass" : "fail",
        detail: parsed.ok
          ? "Configuration is valid."
          : parsed.errors.join(" "),
      });
      if (
        parsed.ok &&
        options.level === "protected-writes" &&
        !parsed.config.enterprise_slug
      ) {
        checks.push({
          name: "enterprise slug",
          status: "fail",
          detail: "enterprise_slug is required for protected writes.",
        });
      }
    }
  }

  const labels =
    (await client.request<Array<{ name: string }>>(
      `repos/${options.repository}/labels?per_page=100`,
    )) ?? [];
  const names = new Set(labels.map((label) => label.name));
  const missingLabels = REQUIRED_LABELS.filter(
    (label) => !names.has(label.name),
  ).map((label) => label.name);
  checks.push({
    name: "labels",
    status: missingLabels.length === 0 ? "pass" : "fail",
    detail:
      missingLabels.length === 0
        ? "All IssueOps labels exist."
        : `Missing labels: ${missingLabels.join(", ")}.`,
  });

  if (options.level !== "triage") {
    const variable = await client.request<{ value?: string }>(
      `repos/${options.repository}/actions/variables/BUDGET_WRITE_ENABLED`,
      { allowNotFound: true },
    );
    checks.push({
      name: "write flag",
      status: variable ? "pass" : "fail",
      detail: variable
        ? `BUDGET_WRITE_ENABLED is ${variable.value === "true" ? "enabled" : "disabled"}.`
        : "BUDGET_WRITE_ENABLED is missing.",
    });
  }

  if (options.level === "protected-writes") {
    const environment = await client.request<{
      protection_rules?: Array<{ type?: string }>;
      deployment_branch_policy?: {
        protected_branches?: boolean;
        custom_branch_policies?: boolean;
      };
    }>(
      `repos/${options.repository}/environments/budget-approver`,
      { allowNotFound: true },
    );
    checks.push({
      name: "protected environment",
      status: environment ? "pass" : "fail",
      detail: environment
        ? "budget-approver exists; verify reviewers and branch restrictions."
        : "budget-approver is missing.",
    });
    if (environment) {
      const hasReviewers =
        environment.protection_rules?.some(
          (rule) => rule.type === "required_reviewers",
        ) ?? false;
      checks.push({
        name: "environment reviewers",
        status: hasReviewers ? "pass" : "fail",
        detail: hasReviewers
          ? "Required reviewers are configured."
          : "Required reviewers are not configured.",
      });
      const protectedBranches =
        environment.deployment_branch_policy?.protected_branches === true &&
        environment.deployment_branch_policy?.custom_branch_policies ===
          false;
      checks.push({
        name: "environment branch policy",
        status: protectedBranches ? "pass" : "fail",
        detail: protectedBranches
          ? "Only protected branches can deploy."
          : "The environment is not restricted to protected branches.",
      });
    }
    const secrets = environment
      ? await client.request<{ secrets?: Array<{ name: string }> }>(
          `repos/${options.repository}/environments/budget-approver/secrets`,
        )
      : undefined;
    const hasAdminSecret =
      secrets?.secrets?.some(
        (secret) => secret.name === "GH_BILLING_ADMIN_TOKEN",
      ) ?? false;
    checks.push({
      name: "administrator secret",
      status: hasAdminSecret ? "pass" : "fail",
      detail: hasAdminSecret
        ? "GH_BILLING_ADMIN_TOKEN exists in budget-approver."
        : "GH_BILLING_ADMIN_TOKEN is missing from budget-approver.",
    });
  }

  return checks;
}
