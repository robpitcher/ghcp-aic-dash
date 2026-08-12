/**
 * GitHub App user-to-server web-flow helpers. Identity-only: the user access
 * token is used once to read the user's login + id, then discarded. GitHub
 * Apps use fine-grained account permissions rather than OAuth scopes — no
 * `scope` parameter is sent (GitHub Apps ignore it and always return an empty
 * string). No account permission is required to read the public `login`/`id`
 * fields, and the token never leaves the server.
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const API_VERSION = "2026-03-10";

/** Build the GitHub App authorize URL with a CSRF `state` value. */
export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchange an authorization code for an access token. Returns the token string,
 * or null when GitHub declines the exchange.
 */
export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string | null> {
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed with status ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: string; error?: string };
  return data.access_token ?? null;
}

export interface GitHubUser {
  login: string;
  id: number;
}

/**
 * Fetch the authenticated user's GitHub identity (login + id) using a freshly
 * minted GitHub App user access token. The token is the caller's
 * responsibility to discard immediately after this returns.
 */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch(USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    },
  });

  if (!res.ok) {
    throw new Error(`User fetch failed with status ${res.status}`);
  }

  const user = (await res.json()) as { login?: string; id?: number };
  if (!user.login || typeof user.id !== "number") {
    throw new Error("GitHub user response missing login or id");
  }
  return { login: user.login, id: user.id };
}
