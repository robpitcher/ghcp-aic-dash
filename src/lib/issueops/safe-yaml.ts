import { DEFAULT_SCHEMA, load } from "js-yaml";

const FORBIDDEN_KEY_PATTERN =
  /^\s*["']?(?:__proto__|prototype|constructor)["']?\s*:/im;
const YAML_REFERENCE_PATTERN = /[&*][A-Za-z0-9_-]+/;

export function containsForbiddenYamlKey(source: string): boolean {
  return FORBIDDEN_KEY_PATTERN.test(source);
}

export function containsYamlReference(source: string): boolean {
  return YAML_REFERENCE_PATTERN.test(source);
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExcessiveYamlDepth(
  value: unknown,
  maxDepth: number,
  depth = 0,
  visited = new WeakSet<object>(),
): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (depth >= maxDepth || visited.has(value)) {
    return true;
  }

  visited.add(value);
  return Object.values(value).some((child) =>
    hasExcessiveYamlDepth(child, maxDepth, depth + 1, visited),
  );
}

export function loadSafeYaml(source: string): unknown {
  return load(source, {
    schema: DEFAULT_SCHEMA,
    json: false,
  });
}
