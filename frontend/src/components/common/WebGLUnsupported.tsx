import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

/** full-screen notice shown when the browser lacks WebGL support. */
export default function WebGLUnsupported() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-tv-bg text-tv-text-primary p-8 text-center">
      <AlertTriangle size={64} className="text-tv-warning mb-6" />
      <h1 className="text-2xl font-semibold mb-3">
        {t("errors.webglUnsupported")}
      </h1>
      <p className="text-tv-text-secondary max-w-[480px] leading-relaxed">
        {t("errors.webglUnsupportedHint")}
      </p>
    </div>
  );
}
