import { useTranslation } from "react-i18next";
import ReadOnlyField from "@/components/common/ReadOnlyField";

interface MehtCheckFieldsProps {
  computedMehtHeight: number | null;
}

export default function MehtCheckFields({
  computedMehtHeight,
}: MehtCheckFieldsProps) {
  /** meht-check derived height readout. */
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="meht-check-fields">
      {computedMehtHeight != null && (
        <>
          <ReadOnlyField
            label={t("mission.config.mehtHeight")}
            hint={t("mission.config.mehtHeightHelp")}
            value={
              <span data-testid="computed-meht-height">
                {computedMehtHeight} {t("mission.config.mehtHeightUnit")}
              </span>
            }
          />
          <p className="text-xs text-tv-text-secondary mt-0.5">
            {t("mission.config.mehtHeightHint")}
          </p>
        </>
      )}
    </div>
  );
}
