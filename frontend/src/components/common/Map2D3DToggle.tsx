import { useTranslation } from "react-i18next";

interface Map2D3DToggleProps {
  is3D: boolean;
  onSet3D: (value: boolean) => void;
  className?: string;
  buttonClassName?: string;
  inactiveClassName?: string;
}

const DEFAULT_CLASS = "flex items-center rounded-full border border-tv-border bg-tv-bg px-1 py-1";
const DEFAULT_BUTTON_CLASS =
  "flex items-center justify-center rounded-full h-9 px-3 text-xs font-medium transition-colors";
const DEFAULT_INACTIVE_CLASS = "text-tv-text-secondary hover:bg-tv-surface-hover";

/** 2d/3d pill toggle shared by the map view toggles and the map controls toolbar. */
export default function Map2D3DToggle({
  is3D,
  onSet3D,
  className = DEFAULT_CLASS,
  buttonClassName = DEFAULT_BUTTON_CLASS,
  inactiveClassName = DEFAULT_INACTIVE_CLASS,
}: Map2D3DToggleProps) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onSet3D(false)}
        title={t("map.tools.2d")}
        className={`${buttonClassName} ${!is3D ? "bg-tv-accent text-tv-accent-text" : inactiveClassName}`}
        data-testid="toggle-2d"
      >
        {t("common.2d")}
      </button>
      <button
        type="button"
        onClick={() => onSet3D(true)}
        title={t("map.tools.3d")}
        className={`${buttonClassName} ${is3D ? "bg-tv-accent text-tv-accent-text" : inactiveClassName}`}
        data-testid="toggle-3d"
      >
        {t("common.3d")}
      </button>
    </div>
  );
}
