"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  MAX_BUDGET_REQUEST_INCREASE_CREDITS,
  MAX_BUDGET_REQUEST_JUSTIFICATION_LENGTH,
  MIN_BUDGET_REQUEST_JUSTIFICATION_LENGTH,
} from "@/lib/budget";
import type { BudgetCardState } from "./budget-card";
import { Banner, Button, Card } from "./ui";

interface BudgetRequestProps {
  budgetState: BudgetCardState;
  repository: string | null;
  demoMode?: boolean;
}

interface PreparedRequest {
  url: string;
  title: string;
  justificationTruncated: boolean;
  openedAutomatically: boolean;
}

export function BudgetRequest({
  budgetState,
  repository,
  demoMode = false,
}: BudgetRequestProps) {
  const [increase, setIncrease] = useState("100");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);

  const increaseCredits = Number(increase);
  const increaseIsValid =
    Number.isInteger(increaseCredits) &&
    increaseCredits > 0 &&
    increaseCredits % 100 === 0 &&
    increaseCredits <= MAX_BUDGET_REQUEST_INCREASE_CREDITS;

  // The preview total tracks whatever positive number is typed, even before it
  // satisfies the multiple-of-100 rule, so the math always matches the input.
  // Submission is still gated on `increaseIsValid`.
  const requestedTotal = useMemo(() => {
    if (
      budgetState.status !== "ready" ||
      !Number.isFinite(increaseCredits) ||
      increaseCredits <= 0
    ) {
      return null;
    }
    return budgetState.budget.amountCredits + increaseCredits;
  }, [budgetState, increaseCredits]);

  if (!repository) {
    return (
      <Card title="Request more credits">
        <Banner
          tone="warning"
          title={
            demoMode
              ? "Budget requests are disabled in demo mode"
              : "Budget requests are not configured"
          }
        >
          {demoMode
            ? "Demo mode uses synthetic data and never contacts GitHub."
            : (
              <>
                Ask the dashboard administrator to set{" "}
                <code>BUDGET_REQUEST_REPOSITORY=OWNER/REPO</code>.
              </>
            )}
        </Banner>
      </Card>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Open synchronously to avoid popup blocking, then sever the opener reference.
    const reviewWindow = window.open("about:blank", "_blank");
    if (reviewWindow) reviewWindow.opener = null;
    setSubmitting(true);
    setError(null);
    setPrepared(null);

    try {
      // Send only user intent; identity and the current budget remain server-owned.
      const response = await fetch("/api/budget/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestedIncreaseCredits: increaseCredits,
          justification,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<
        PreparedRequest & { error: string }
      >;

      if (!response.ok || !payload.url || !payload.title) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      const result: PreparedRequest = {
        url: payload.url,
        title: payload.title,
        justificationTruncated: payload.justificationTruncated === true,
        openedAutomatically: reviewWindow !== null,
      };
      setPrepared(result);
      // Navigation happens only after the server returns the sanitized issue URL.
      if (reviewWindow) reviewWindow.location.href = result.url;
    } catch (err) {
      reviewWindow?.close();
      setError(
        err instanceof Error ? err.message : "Failed to prepare the request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const ready = budgetState.status === "ready";

  return (
    <Card
      title="Request more credits"
      subtitle="Prepare a GitHub issue for review; this dashboard never changes your budget."
    >
      <Banner tone="info" title="Repository visibility notice">
        Your request and the current usage values included in it will be visible
        to collaborators in <strong>{repository}</strong>.
      </Banner>

      {!ready ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          Your effective budget must be available before a request can be
          prepared.
        </p>
      ) : (
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <div>
            <label
              className="block text-sm font-medium text-gray-800 dark:text-gray-200"
              htmlFor="budget-request-increase"
            >
              Requested increase in AI credits
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              id="budget-request-increase"
              inputMode="numeric"
              max={MAX_BUDGET_REQUEST_INCREASE_CREDITS}
              min={100}
              onChange={(event) => setIncrease(event.target.value)}
              required
              step={100}
              type="number"
              value={increase}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Enter a positive multiple of 100 credits, up to{" "}
              {MAX_BUDGET_REQUEST_INCREASE_CREDITS.toLocaleString()}.
            </p>
            {!increaseIsValid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                Must be a positive multiple of 100, up to{" "}
                {MAX_BUDGET_REQUEST_INCREASE_CREDITS.toLocaleString()}.
              </p>
            )}
          </div>

          <div
            aria-live="polite"
            className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            Current budget:{" "}
            <strong>{budgetState.budget.amountCredits.toLocaleString()}</strong>{" "}
            credits. Requested total:{" "}
            <strong>
              {requestedTotal === null
                ? "Enter a valid increase"
                : requestedTotal.toLocaleString()}
            </strong>
            {requestedTotal !== null && " credits"}.
          </div>

          <div>
            <label
              className="block text-sm font-medium text-gray-800 dark:text-gray-200"
              htmlFor="budget-request-justification"
            >
              Business justification
            </label>
            <textarea
              className="mt-1 min-h-32 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              id="budget-request-justification"
              maxLength={MAX_BUDGET_REQUEST_JUSTIFICATION_LENGTH}
              minLength={MIN_BUDGET_REQUEST_JUSTIFICATION_LENGTH}
              onChange={(event) => setJustification(event.target.value)}
              required
              value={justification}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {MIN_BUDGET_REQUEST_JUSTIFICATION_LENGTH}-
              {MAX_BUDGET_REQUEST_JUSTIFICATION_LENGTH.toLocaleString()}{" "}
              characters. Expiration is fixed to the end of the current UTC
              billing month.
            </p>
          </div>

          {error && (
            <Banner tone="error" title="Could not prepare request">
              {error}
            </Banner>
          )}

          {prepared && (
            <Banner tone="info" title="GitHub request prepared">
              <p>
                {prepared.openedAutomatically
                  ? "A new tab was opened for you to review and submit the issue."
                  : "Your browser blocked the new tab. Use the link below to review and submit the issue."}
              </p>
              {prepared.justificationTruncated && (
                <p className="mt-1 font-medium">
                  The justification was truncated to keep the GitHub URL within
                  its safe length.
                </p>
              )}
              <a
                className="mt-2 inline-block font-semibold underline"
                href={prepared.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                Open the prepared GitHub issue
              </a>
            </Banner>
          )}

          <Button
            disabled={submitting || !increaseIsValid}
            type="submit"
          >
            {submitting ? "Preparing request..." : "Review request on GitHub"}
          </Button>
        </form>
      )}
    </Card>
  );
}
