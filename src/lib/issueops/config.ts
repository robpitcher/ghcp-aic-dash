import { readFile } from "node:fs/promises";
import type { BudgetRequestPolicyLimits } from "./policy";
import {
  containsForbiddenYamlKey,
  containsYamlReference,
  hasExcessiveYamlDepth,
  isPlainObject,
  loadSafeYaml,
} from "./safe-yaml";

export const ISSUEOPS_CONFIG_SCHEMA = "ghcp-aic-issueops:v1";
export const DEFAULT_ISSUEOPS_CONFIG_PATH =
  ".github/ghcp-aic-issueops.yml";
export const MAX_ISSUEOPS_CONFIG_LENGTH = 8_192;
export const MAX_ISSUEOPS_CONFIG_DEPTH = 3;

const EXPECTED_ROOT_KEYS = [
  "schema",
  "enterprise_slug",
  "auto_approval",
] as const;
const EXPECTED_POLICY_KEYS = [
  "max_delta_credits",
  "max_total_credits",
] as const;
const ENTERPRISE_SLUG_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export interface IssueOpsConfig {
  schema: typeof ISSUEOPS_CONFIG_SCHEMA;
  enterprise_slug: string | null;
  auto_approval: {
    max_delta_credits: number;
    max_total_credits: number;
  };
}

export type IssueOpsConfigParseResult =
  | { ok: true; config: IssueOpsConfig }
  | { ok: false; errors: string[] };

function validateExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  errors: string[],
): void {
  const keys = Object.keys(value);
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`Missing ${label} field: ${key}.`);
    }
  }
  for (const key of keys) {
    if (!expected.includes(key)) {
      errors.push(`Unexpected ${label} field: ${key}.`);
    }
  }
  if (
    keys.length === expected.length &&
    keys.some((key, index) => key !== expected[index])
  ) {
    errors.push(`${label} fields must appear in the documented order.`);
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseIssueOpsConfig(
  source: string,
): IssueOpsConfigParseResult {
  if (source.length > MAX_ISSUEOPS_CONFIG_LENGTH) {
    return {
      ok: false,
      errors: [
        `IssueOps configuration exceeds the ${MAX_ISSUEOPS_CONFIG_LENGTH}-character limit.`,
      ],
    };
  }
  if (containsForbiddenYamlKey(source)) {
    return {
      ok: false,
      errors: [
        "IssueOps configuration contains a forbidden prototype-related key.",
      ],
    };
  }
  if (containsYamlReference(source)) {
    return {
      ok: false,
      errors: ["IssueOps configuration cannot use YAML anchors or aliases."],
    };
  }

  let document: unknown;
  try {
    document = loadSafeYaml(source);
  } catch {
    return {
      ok: false,
      errors: ["IssueOps configuration is not valid safe YAML."],
    };
  }
  if (!isPlainObject(document)) {
    return {
      ok: false,
      errors: ["IssueOps configuration must contain one plain object."],
    };
  }
  if (hasExcessiveYamlDepth(document, MAX_ISSUEOPS_CONFIG_DEPTH)) {
    return {
      ok: false,
      errors: [
        `IssueOps configuration exceeds the maximum depth of ${MAX_ISSUEOPS_CONFIG_DEPTH}.`,
      ],
    };
  }

  const errors: string[] = [];
  validateExactKeys(document, EXPECTED_ROOT_KEYS, "configuration", errors);
  if (document.schema !== ISSUEOPS_CONFIG_SCHEMA) {
    errors.push(`schema must equal "${ISSUEOPS_CONFIG_SCHEMA}".`);
  }
  if (
    document.enterprise_slug !== null &&
    (typeof document.enterprise_slug !== "string" ||
      !ENTERPRISE_SLUG_PATTERN.test(document.enterprise_slug))
  ) {
    errors.push(
      "enterprise_slug must be null or a lower-case GitHub Enterprise slug.",
    );
  }

  const policy = document.auto_approval;
  if (!isPlainObject(policy)) {
    errors.push("auto_approval must be a plain object.");
  } else {
    validateExactKeys(policy, EXPECTED_POLICY_KEYS, "auto_approval", errors);
    if (!isNonNegativeSafeInteger(policy.max_delta_credits)) {
      errors.push(
        "auto_approval.max_delta_credits must be a non-negative safe integer.",
      );
    }
    if (!isNonNegativeSafeInteger(policy.max_total_credits)) {
      errors.push(
        "auto_approval.max_total_credits must be a non-negative safe integer.",
      );
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, config: document as unknown as IssueOpsConfig };
}

export async function loadIssueOpsConfig(
  path = DEFAULT_ISSUEOPS_CONFIG_PATH,
): Promise<IssueOpsConfig> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read IssueOps configuration at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const parsed = parseIssueOpsConfig(source);
  if (!parsed.ok) {
    throw new Error(
      `Invalid IssueOps configuration at ${path}: ${parsed.errors.join(" ")}`,
    );
  }
  return parsed.config;
}

export function getIssueOpsPolicyLimits(
  config: IssueOpsConfig,
): BudgetRequestPolicyLimits {
  return {
    maxDeltaCredits: config.auto_approval.max_delta_credits,
    maxTotalCredits: config.auto_approval.max_total_credits,
  };
}

export function requireIssueOpsEnterpriseSlug(
  config: IssueOpsConfig,
): string {
  if (!config.enterprise_slug) {
    throw new Error(
      "enterprise_slug must be configured in .github/ghcp-aic-issueops.yml for protected writes.",
    );
  }
  return config.enterprise_slug;
}
