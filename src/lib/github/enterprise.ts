/**
 * Enterprise membership verification via the GraphQL API.
 *
 * Reuses the existing privileged billing token (already scoped `read:enterprise`)
 * — no new credential is introduced. This is deliberately GraphQL rather than
 * REST: `GET /enterprises/{enterprise}/consumed-licenses` is a license report
 * that may omit enterprise members who hold only a Copilot license via an
 * enterprise team (no org membership, no GitHub Enterprise seat), and the
 * enterprise-teams REST membership endpoints are documented as incompatible
 * with fine-grained/App tokens and would require enumerating every team.
 *
 * IMPORTANT: `enterprise.members(query:)` is a FUZZY/substring search, not an
 * exact lookup — querying "bob" can return "bobby". Callers of this module
 * never see raw results; `isEnterpriseMember` always performs an exact,
 * case-insensitive match against the returned logins before deciding.
 */

const GRAPHQL_URL = "https://api.github.com/graphql";

const MEMBERS_QUERY = `
  query EnterpriseMemberLookup($slug: String!, $login: String!, $after: String) {
    enterprise(slug: $slug) {
      members(first: 100, query: $login, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ... on EnterpriseUserAccount {
            login
          }
          ... on User {
            login
          }
        }
      }
    }
  }
`;

/** Raised when the membership lookup itself fails (network/GraphQL error). */
export class MembershipCheckError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MembershipCheckError";
  }
}

interface GraphQlMemberNode {
  login?: string | null;
}

interface GraphQlMembersResponse {
  data?: {
    enterprise: {
      members: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: (GraphQlMemberNode | null)[];
      } | null;
    } | null;
  };
  errors?: { message: string }[];
}

/** Hard cap on pages walked per lookup — the fuzzy query rarely returns more. */
const MAX_PAGES = 3;

export interface EnterpriseMembershipOptions {
  /** Privileged enterprise billing token (server-side only). */
  token: string;
  /** Enterprise slug. */
  enterpriseSlug: string;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Check whether `login` is a member of the configured GitHub Enterprise
 * (including unaffiliated members who belong to no organization but were added
 * directly to the enterprise or an enterprise team). Performs an exact,
 * case-insensitive comparison against the fuzzy-matched candidates GitHub
 * returns — never trust non-emptiness of the result set alone.
 *
 * Throws `MembershipCheckError` on any transport/GraphQL failure so callers can
 * fail closed rather than silently treating an error as "not a member".
 */
export async function isEnterpriseMember(
  login: string,
  opts: EnterpriseMembershipOptions,
): Promise<boolean> {
  const target = login.trim().toLowerCase();
  if (!target) return false;

  const fetchImpl = opts.fetchImpl ?? fetch;
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetchImpl(GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          query: MEMBERS_QUERY,
          variables: { slug: opts.enterpriseSlug, login: target, after },
        }),
      });
    } catch (err) {
      throw new MembershipCheckError(
        `Network error verifying enterprise membership: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MembershipCheckError(
        `Enterprise membership lookup failed (${res.status} ${res.statusText}). ${body.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as GraphQlMembersResponse;

    if (json.errors && json.errors.length > 0) {
      throw new MembershipCheckError(
        `Enterprise membership lookup returned GraphQL errors: ${json.errors
          .map((e) => e.message)
          .join("; ")}`,
      );
    }

    const members = json.data?.enterprise?.members;
    if (!members) {
      throw new MembershipCheckError(
        "Enterprise membership lookup returned no data (check enterprise slug and token permissions).",
      );
    }

    const exactMatch = members.nodes.some(
      (node) => node?.login?.toLowerCase() === target,
    );
    if (exactMatch) return true;

    if (!members.pageInfo.hasNextPage) return false;
    after = members.pageInfo.endCursor;
  }

  return false;
}

/* ── TTL cache ──────────────────────────────────────────────────────────────
 * Membership rarely changes minute-to-minute, and the check now runs both at
 * sign-in and on every data request, so results (positive AND negative) are
 * cached briefly to avoid a GraphQL round-trip per dashboard load. Errors are
 * NEVER cached — a transient outage must not pin a user out (or in) for the
 * TTL window; callers see the error every time until the lookup recovers.
 *
 * This cache is per-process. On multi-replica deployments (e.g. Azure
 * Container Apps with >1 replica) each replica holds its own cache, so
 * revocation can lag by up to CACHE_TTL_MS on a given replica.
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const membershipCache = new Map<string, CacheEntry>();

/**
 * Cached wrapper around `isEnterpriseMember`. Prefer this over the raw
 * function in request-handling code; use the raw function directly only in
 * tests or callers that need to bypass caching.
 */
export async function checkEnterpriseMembership(
  login: string,
  opts: EnterpriseMembershipOptions,
): Promise<boolean> {
  const key = `${login.trim().toLowerCase()}:${opts.enterpriseSlug}`;
  const cached = membershipCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.value;
    }
    membershipCache.delete(key);
  }

  const result = await isEnterpriseMember(login, opts);
  membershipCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Test-only hook to reset the module-level membership cache between tests. */
export function __resetMembershipCache(): void {
  membershipCache.clear();
}
