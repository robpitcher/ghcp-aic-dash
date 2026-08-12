import { BUDGET_REQUEST_SCHEMA_MARKER } from "../budget";
import {
  containsForbiddenYamlKey,
  containsYamlReference,
  hasExcessiveYamlDepth,
  isPlainObject,
  loadSafeYaml,
} from "./safe-yaml";

export const BUDGET_REQUEST_TITLE_PREFIX = "[AI Credit Budget Request]";
export const MAX_BUDGET_REQUEST_BODY_LENGTH = 65_536;
export const MAX_BUDGET_REQUEST_YAML_LENGTH = 8_192;
export const MAX_BUDGET_REQUEST_YAML_DEPTH = 3;

const EXPECTED_KEYS = [
  "schema",
  "requester",
  "current_budget_credits",
  "current_consumed_credits",
  "requested_increase_credits",
  "requested_total_credits",
  "effective_source",
  "expiration_date",
  "generated_at",
] as const;

const EFFECTIVE_SOURCES = ["individual", "cost_center", "universal"] as const;
export type BudgetRequestEffectiveSource = (typeof EFFECTIVE_SOURCES)[number];

export interface ParsedBudgetRequest {
  schema: typeof BUDGET_REQUEST_SCHEMA_MARKER;
  requester: string;
  current_budget_credits: number;
  current_consumed_credits: number;
  requested_increase_credits: number;
  requested_total_credits: number;
  effective_source: BudgetRequestEffectiveSource;
  expiration_date: string;
  generated_at: string;
}

export type BudgetRequestParseResult =
  | { ok: true; request: ParsedBudgetRequest }
  | { ok: false; errors: string[] };

function findStructuredYaml(body: string): string | undefined {
  const yamlFence = /```yaml[^\S\r\n]*\r?\n([\s\S]*?)```/gi;

  for (const match of body.matchAll(yamlFence)) {
    const yaml = match[1];
    if (yaml.includes(BUDGET_REQUEST_SCHEMA_MARKER)) {
      return yaml;
    }
  }

  return undefined;
}

function validateNonNegativeInteger(
  value: unknown,
  field: string,
  errors: string[],
): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    errors.push(`${field} must be a non-negative integer.`);
    return false;
  }
  return true;
}

export function isBudgetRequestIssue(title: string, body: string): boolean {
  return (
    title.startsWith(BUDGET_REQUEST_TITLE_PREFIX) &&
    body.includes(BUDGET_REQUEST_SCHEMA_MARKER)
  );
}

/**
 * Uses the first fenced YAML block containing the schema marker. This makes
 * multiple-block behavior deterministic and prevents a later block from
 * overriding the submitted request.
 */
export function parseBudgetRequestBody(
  body: string,
): BudgetRequestParseResult {
  // Bound untrusted issue content before searching for or decoding YAML.
  if (body.length > MAX_BUDGET_REQUEST_BODY_LENGTH) {
    return {
      ok: false,
      errors: [
        `Issue body exceeds the ${MAX_BUDGET_REQUEST_BODY_LENGTH}-character limit.`,
      ],
    };
  }

  const yaml = findStructuredYaml(body);
  if (yaml === undefined) {
    return {
      ok: false,
      errors: [
        "Add a fenced ```yaml block containing the budget request schema marker.",
      ],
    };
  }

  if (yaml.length > MAX_BUDGET_REQUEST_YAML_LENGTH) {
    return {
      ok: false,
      errors: [
        `Structured YAML exceeds the ${MAX_BUDGET_REQUEST_YAML_LENGTH}-character limit.`,
      ],
    };
  }

  if (containsForbiddenYamlKey(yaml)) {
    return {
      ok: false,
      errors: ["Structured YAML contains a forbidden prototype-related key."],
    };
  }

  if (containsYamlReference(yaml)) {
    return {
      ok: false,
      errors: ["YAML anchors and aliases are not allowed."],
    };
  }

  let document: unknown;
  try {
    document = loadSafeYaml(yaml);
  } catch {
    return {
      ok: false,
      errors: ["Structured YAML is not valid safe YAML."],
    };
  }

  if (!isPlainObject(document)) {
    return {
      ok: false,
      errors: ["Structured YAML must contain one plain object."],
    };
  }

  if (hasExcessiveYamlDepth(document, MAX_BUDGET_REQUEST_YAML_DEPTH)) {
    return {
      ok: false,
      errors: [
        `Structured YAML exceeds the maximum depth of ${MAX_BUDGET_REQUEST_YAML_DEPTH}.`,
      ],
    };
  }

  // Require the documented flat schema exactly so automation never interprets
  // ambiguous, reordered, or silently extended request data.
  const keys = Object.keys(document);
  const errors: string[] = [];
  for (const key of EXPECTED_KEYS) {
    if (!Object.hasOwn(document, key)) {
      errors.push(`Missing required field: ${key}.`);
    }
  }
  for (const key of keys) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      errors.push(`Unexpected field: ${key}.`);
    }
  }
  if (
    keys.length === EXPECTED_KEYS.length &&
    keys.some((key, index) => key !== EXPECTED_KEYS[index])
  ) {
    errors.push("Structured fields must appear in the documented order.");
  }

  if (document.schema !== BUDGET_REQUEST_SCHEMA_MARKER) {
    errors.push(`schema must equal "${BUDGET_REQUEST_SCHEMA_MARKER}".`);
  }
  if (
    typeof document.requester !== "string" ||
    !/^[A-Za-z\d](?:[A-Za-z\d_-]{0,38})$/.test(document.requester)
  ) {
    errors.push("requester must be a valid GitHub login.");
  }

  const currentBudgetCredits = document.current_budget_credits;
  const requestedIncreaseCredits = document.requested_increase_credits;
  const requestedTotalCredits = document.requested_total_credits;
  // Validate arithmetic fields together after their primitive types are known.
  const currentBudgetValid = validateNonNegativeInteger(
    currentBudgetCredits,
    "current_budget_credits",
    errors,
  );
  validateNonNegativeInteger(
    document.current_consumed_credits,
    "current_consumed_credits",
    errors,
  );
  const increaseValid = validateNonNegativeInteger(
    requestedIncreaseCredits,
    "requested_increase_credits",
    errors,
  );
  const totalValid = validateNonNegativeInteger(
    requestedTotalCredits,
    "requested_total_credits",
    errors,
  );

  if (increaseValid && requestedIncreaseCredits <= 0) {
    errors.push("requested_increase_credits must be greater than zero.");
  }
  if (increaseValid && requestedIncreaseCredits % 100 !== 0) {
    errors.push("requested_increase_credits must be a multiple of 100.");
  }
  if (
    currentBudgetValid &&
    increaseValid &&
    totalValid &&
    requestedTotalCredits !== currentBudgetCredits + requestedIncreaseCredits
  ) {
    errors.push(
      "requested_total_credits must equal current_budget_credits plus requested_increase_credits.",
    );
  }

  if (
    typeof document.effective_source !== "string" ||
    !(EFFECTIVE_SOURCES as readonly string[]).includes(
      document.effective_source,
    )
  ) {
    errors.push(
      "effective_source must be individual, cost_center, or universal.",
    );
  }
  if (
    typeof document.expiration_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(document.expiration_date)
  ) {
    errors.push("expiration_date must be a UTC date in YYYY-MM-DD format.");
  }
  if (
    typeof document.generated_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      document.generated_at,
    ) ||
    Number.isNaN(Date.parse(document.generated_at))
  ) {
    errors.push("generated_at must be a valid ISO 8601 UTC timestamp.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    request: document as unknown as ParsedBudgetRequest,
  };
}
