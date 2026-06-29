import { useTranslation } from "react-i18next";
import { lightColor } from "./chartColors";

interface PapiUnitSelectorProps {
  // light names, e.g. ["PAPI_A","PAPI_B","PAPI_C","PAPI_D"]
  lights: string[];
  active: string;
  onChange: (light: string) => void;
}

/** a/b/c/d pill selector mirroring the annotated-video track picker. */
export default function PapiUnitSelector({
  lights,
  active,
  onChange,
}: PapiUnitSelectorProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-3"
      role="group"
      aria-label={t("results.perLight.selectorAria")}
    >
      {lights.map((light) => (
        <button
          key={light}
          type="button"
          onClick={() => onChange(light)}
          aria-pressed={light === active}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
            light === active
              ? "bg-tv-accent text-tv-accent-text"
              : "bg-tv-surface-hover text-tv-text-secondary hover:text-tv-text-primary"
          }`}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: lightColor(light) }}
            aria-hidden="true"
          />
          {light.replace("PAPI_", "")}
        </button>
      ))}
    </div>
  );
}
