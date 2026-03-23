import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const token = searchParams.get("token")?.trim() ?? "";
  const redirectError = searchParams.get("error");
  const canSubmit =
    token.length > 0 &&
    password.trim().length >= 8 &&
    confirmPassword.trim().length > 0 &&
    password === confirmPassword;

  const initialError = useMemo(() => {
    if (redirectError === "INVALID_TOKEN") return "This reset link is invalid or has expired.";
    return null;
  }, [redirectError]);

  const mutation = useMutation({
    mutationFn: async () => {
      await authApi.resetPassword({
        token,
        newPassword: password,
      });
    },
    onSuccess: () => {
      setError(null);
      setCompleted(true);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Password reset failed");
    },
  });

  return (
    <div className="fixed inset-0 flex bg-background">
      <div className="w-full flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Paperclip</span>
          </div>

          <h1 className="text-xl font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a new password for this Paperclip account.
          </p>

          {completed ? (
            <div className="mt-6 space-y-4 rounded-md border border-border bg-card p-4">
              <p className="text-sm">Password updated. You can sign in with the new password now.</p>
              <Button type="button" className="w-full" onClick={() => navigate("/auth", { replace: true })}>
                Back to Sign In
              </Button>
            </div>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (mutation.isPending) return;
                if (!token) {
                  setError("This reset link is invalid or has expired.");
                  return;
                }
                if (!canSubmit) {
                  setError("Enter a new password and make sure both fields match.");
                  return;
                }
                mutation.mutate();
              }}
            >
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">New Password</label>
                <input
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Confirm Password</label>
                <input
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {(initialError || error) && <p className="text-xs text-destructive">{initialError ?? error}</p>}
              <Button
                type="submit"
                disabled={mutation.isPending || Boolean(initialError)}
                aria-disabled={!canSubmit || mutation.isPending || Boolean(initialError)}
                className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
              >
                {mutation.isPending ? "Updating..." : "Set New Password"}
              </Button>
            </form>
          )}

          <div className="mt-5 text-sm text-muted-foreground">
            <Link to="/auth" className="font-medium text-foreground underline underline-offset-2">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
