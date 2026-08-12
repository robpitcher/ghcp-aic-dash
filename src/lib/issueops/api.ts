import type { RawGitHubBudgetsResponse } from "../budget";
import { EnterpriseBillingClient } from "../github/client";

const API_ROOT = "https://api.github.com";
export const BUDGET_API_VERSION = "2026-03-10";

export interface WorkflowIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  labels: Array<{ name: string }>;
}

export interface WorkflowComment {
  id: number;
  body: string | null;
  user: { type: string };
}

export interface IssueOpsClient {
  getIssue(number: number): Promise<WorkflowIssue | undefined>;
  getVerifiedLogin(login: string): Promise<string>;
  listComments(number: number): Promise<WorkflowComment[]>;
  findAppliedIssues(): Promise<WorkflowIssue[]>;
  ensureLabels(
    labels: Array<{ name: string; color: string; description: string }>,
  ): Promise<void>;
  upsertMarkedComment(
    issueNumber: number,
    marker: string,
    body: string,
  ): Promise<void>;
  reconcileLabels(
    issueNumber: number,
    add: string[],
    remove: string[],
  ): Promise<void>;
  closeIssue(issueNumber: number): Promise<void>;
}

export class GitHubIssueOpsClient implements IssueOpsClient {
  constructor(
    private readonly token: string,
    private readonly repository: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allowed: number[] = [],
  ): Promise<T | undefined> {
    const response = await this.fetchImpl(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": BUDGET_API_VERSION,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (allowed.includes(response.status)) return undefined;
    if (!response.ok) {
      throw new Error(
        `GitHub API ${init.method ?? "GET"} ${path} failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    }
    if (response.status === 204) return undefined;
    return (await response.json()) as T;
  }

  private repoPath(suffix: string): string {
    const [owner, repo] = this.repository.split("/");
    if (!owner || !repo) throw new Error("GITHUB_REPOSITORY is invalid.");
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
  }

  getIssue(number: number): Promise<WorkflowIssue | undefined> {
    return this.request(this.repoPath(`/issues/${number}`));
  }

  async getVerifiedLogin(login: string): Promise<string> {
    const user = await this.request<{ login: string }>(
      `/users/${encodeURIComponent(login)}`,
    );
    if (!user?.login) throw new Error("Requester could not be revalidated.");
    return user.login;
  }

  async listComments(number: number): Promise<WorkflowComment[]> {
    // Walk every page because an older marked audit comment may not be recent.
    const comments: WorkflowComment[] = [];
    for (let page = 1; ; page += 1) {
      const batch =
        (await this.request<WorkflowComment[]>(
          this.repoPath(
            `/issues/${number}/comments?per_page=100&page=${page}`,
          ),
        )) ?? [];
      comments.push(...batch);
      if (batch.length < 100) return comments;
    }
  }

  async findAppliedIssues(): Promise<WorkflowIssue[]> {
    // Include recognized requests as well as the operational label so a
    // successfully written audit remains discoverable if label reconciliation
    // failed after the billing mutation.
    const issues = new Map<number, WorkflowIssue>();
    for (const label of ["budget-applied", "budget-request"]) {
      for (let page = 1; page <= 20; page += 1) {
        const batch =
          (await this.request<WorkflowIssue[]>(
            this.repoPath(
              `/issues?state=all&labels=${label}&per_page=100&page=${page}`,
            ),
          )) ?? [];
        for (const issue of batch) {
          if (!("pull_request" in issue)) {
            issues.set(issue.number, issue);
          }
        }
        if (batch.length < 100) break;
      }
    }
    return [...issues.values()];
  }

  async ensureLabels(
    labels: Array<{ name: string; color: string; description: string }>,
  ): Promise<void> {
    const existing =
      (await this.request<Array<{ name: string }>>(
        this.repoPath("/labels?per_page=100"),
      )) ?? [];
    const names = new Set(existing.map((label) => label.name));
    for (const label of labels) {
      if (!names.has(label.name)) {
        await this.request(
          this.repoPath("/labels"),
          { method: "POST", body: JSON.stringify(label) },
          [422],
        );
      }
    }
  }

  async upsertMarkedComment(
    issueNumber: number,
    marker: string,
    body: string,
  ): Promise<void> {
    // Markers make workflow status comments idempotent across reruns.
    const comments = await this.listComments(issueNumber);
    const current = comments.filter(
      (comment) =>
        comment.user.type === "Bot" && comment.body?.includes(marker),
    );
    if (current.length > 0) {
      await this.request(this.repoPath(`/issues/comments/${current[0].id}`), {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      for (const duplicate of current.slice(1)) {
        await this.request(
          this.repoPath(`/issues/comments/${duplicate.id}`),
          { method: "DELETE" },
          [404],
        );
      }
    } else {
      await this.request(this.repoPath(`/issues/${issueNumber}/comments`), {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    }
  }

  async reconcileLabels(
    issueNumber: number,
    add: string[],
    remove: string[],
  ): Promise<void> {
    for (const label of remove) {
      await this.request(
        this.repoPath(
          `/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
        ),
        { method: "DELETE" },
        [404],
      );
    }
    if (add.length > 0) {
      await this.request(this.repoPath(`/issues/${issueNumber}/labels`), {
        method: "POST",
        body: JSON.stringify({ labels: add }),
      });
    }
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.request(this.repoPath(`/issues/${issueNumber}`), {
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
    });
  }
}

export interface BudgetAdminClient {
  getUserBudgets(user: string): Promise<RawGitHubBudgetsResponse>;
  createBudget(
    body: Record<string, unknown>,
  ): Promise<{ id: string } | undefined>;
  patchBudget(id: string, body: Record<string, unknown>): Promise<unknown>;
  deleteBudget(id: string): Promise<unknown>;
}

export class BillingAdminClient implements BudgetAdminClient {
  private readonly reader: EnterpriseBillingClient;
  private readonly root: string;

  constructor(
    token: string,
    enterprise: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.reader = new EnterpriseBillingClient({
      token,
      enterpriseSlug: enterprise,
      fetchImpl,
    });
    this.root = `${API_ROOT}/enterprises/${encodeURIComponent(enterprise)}/settings/billing/budgets`;
    this.token = token;
  }

  private readonly token: string;

  getUserBudgets(user: string): Promise<RawGitHubBudgetsResponse> {
    return this.reader.getUserBudgets(user);
  }

  private async mutate<T>(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<T | undefined> {
    // Administrative writes use the dedicated credential and never share a
    // browser-visible or dashboard read path.
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": BUDGET_API_VERSION,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(
        `GitHub billing API ${method} failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    }
    if (response.status === 204) return undefined;
    return (await response.json()) as T;
  }

  async createBudget(
    body: Record<string, unknown>,
  ): Promise<{ id: string } | undefined> {
    const response = await this.mutate<{
      id?: unknown;
      budget?: { id?: unknown };
    }>(this.root, "POST", body);
    const id = response?.budget?.id ?? response?.id;
    return typeof id === "string" ? { id } : undefined;
  }

  patchBudget(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.mutate(`${this.root}/${encodeURIComponent(id)}`, "PATCH", body);
  }

  deleteBudget(id: string): Promise<unknown> {
    return this.mutate(`${this.root}/${encodeURIComponent(id)}`, "DELETE");
  }
}
