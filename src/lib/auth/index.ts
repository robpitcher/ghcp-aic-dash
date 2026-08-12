export {
  COOKIE_NAMES,
  type IdentitySession,
  safeCompare,
  isIdentityModeEnabled,
  createIdentitySession,
  verifyIdentitySession,
  sessionCookieOptions,
  getIdentitySessionFromRequest,
} from "./session";

export { type Role, resolveRole, resolveUserScope } from "./scope";

export { type GuardResult, requireIdentitySession, requireEnterpriseMember } from "./guards";

export {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  type GitHubUser,
} from "./oauth";
