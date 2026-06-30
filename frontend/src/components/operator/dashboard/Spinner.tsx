import { Loader2 } from "lucide-react";

/** centered spinning loader used across dashboard sections. */
export default function Spinner() {
  return (
    <div className="flex justify-center py-6">
      <Loader2 className="h-5 w-5 animate-spin text-tv-text-muted" />
    </div>
  );
}
