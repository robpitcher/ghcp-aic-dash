import { Banner, Card } from "./ui";

/** Centered spinner with a message. */
export function LoadingState({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500 dark:text-gray-400">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-600 dark:border-t-blue-400"
        aria-hidden
      />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/** Empty state — valid request, but no usage in the period. */
export function EmptyState({
  message = "No AI credit usage recorded for this month.",
}: {
  message?: string;
}) {
  return (
    <Card>
      <div className="py-12 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      </div>
    </Card>
  );
}

/** Error state — something failed while loading usage. */
export function ErrorState({ message }: { message: string }) {
  return (
    <Banner tone="error" title="Couldn't load your usage">
      <p>{message}</p>
      <p className="mt-2 text-xs opacity-80">
        If this persists, the privileged billing token may be missing the
        required scopes (manage_billing:copilot read + read:enterprise) or the
        enterprise slug may be wrong.
      </p>
    </Banner>
  );
}

/** Not-configured state — required environment variables are missing. */
export function NotConfiguredState() {
  return (
    <Banner tone="warning" title="Dashboard not fully configured">
      <p>
        The server is missing required configuration. An operator must set the
        GitHub App credentials, a session secret, and the privileged
        enterprise billing token.
      </p>
      <p className="mt-2 text-xs opacity-80">
        See <span className="font-mono">.env.example</span> and the README for
        the full list of required environment variables.
      </p>
    </Banner>
  );
}

/** Not-a-member state — the signed-in GitHub account isn't an enterprise member. */
export function NotAMemberState() {
  return (
    <Banner tone="warning" title="Not a member of this enterprise">
      <p>
        Your GitHub account isn&apos;t a member of this GitHub Enterprise, so we
        can&apos;t show any AI credit usage. Contact your enterprise
        administrator if you believe this is a mistake.
      </p>
    </Banner>
  );
}

/** Verification-failed state — membership couldn't be checked right now. */
export function VerificationFailedState() {
  return (
    <Banner tone="error" title="Couldn't verify enterprise membership">
      <p>
        We couldn&apos;t confirm your enterprise membership right now. Please try
        signing in again in a moment.
      </p>
    </Banner>
  );
}
