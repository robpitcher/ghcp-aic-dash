"use client";

import { useTheme } from "./theme-provider";
import { Button } from "./ui";

/** Top-of-page header: title/subtitle, signed-in user, theme toggle, sign out. */
export function PageHeader({
  title,
  subtitle,
  login,
}: {
  title: string;
  subtitle?: string;
  login?: string | null;
}) {
  const { theme, toggle } = useTheme();

  async function signOut() {
    // Expire the server session before a hard navigation clears client state.
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        {login && (
          <span className="hidden text-sm text-gray-500 sm:inline dark:text-gray-400">
            Signed in as{" "}
            <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
              {login}
            </span>
          </span>
        )}
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
