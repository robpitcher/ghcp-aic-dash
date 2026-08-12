import { redirect } from "next/navigation";
import { isDemoMode, isIdentityConfigured } from "@/lib/config";
import { getServerIdentitySession } from "@/lib/auth/server";
import {
  NotAMemberState,
  NotConfiguredState,
  VerificationFailedState,
} from "@/components/states";

export const dynamic = "force-dynamic";

/** GitHub mark for the sign-in button. */
function GitHubMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * Sign-in screen. Offers the GitHub App web flow (identity only — no scope is
 * requested; GitHub Apps use fine-grained account permissions instead).
 * Already-authenticated developers are sent straight to the dashboard.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (isDemoMode()) redirect("/");

  if (!isIdentityConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
        <NotConfiguredState />
      </main>
    );
  }

  const session = await getServerIdentitySession();
  if (session) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 text-center shadow-xs dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          AI Credit Dashboard
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Sign in with GitHub to see your own Copilot AI credit usage for the
          month.
        </p>
        {error === "not_member" && (
          <div className="mt-4 text-left">
            <NotAMemberState />
          </div>
        )}
        {error === "verification_failed" && (
          <div className="mt-4 text-left">
            <VerificationFailedState />
          </div>
        )}
        <a
          href="/api/auth/github/login"
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
        >
          <GitHubMark />
          Sign in with GitHub
        </a>
        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
          We only read your GitHub login to identify you and verify you&apos;re a
          member of this enterprise. Your usage data is read server-side with a
          privileged token and is scoped to your account.
        </p>
      </div>
    </main>
  );
}
