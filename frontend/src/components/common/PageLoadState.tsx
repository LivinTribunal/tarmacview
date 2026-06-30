import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

interface PageLoadStateProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children?: ReactNode;
}

/** shared loading spinner / error-retry gate for the operator mission pages. */
export default function PageLoadState({
  loading,
  error,
  onRetry,
  children,
}: PageLoadStateProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-tv-error">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 rounded-full text-sm font-semibold bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover transition-colors"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
