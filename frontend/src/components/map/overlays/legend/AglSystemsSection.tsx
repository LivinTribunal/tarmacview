import { useState } from "react";
import { useTranslation } from "react-i18next";
import { papiItems, relItems } from "./legendEntries";
import { SectionChevron, Swatch } from "./Swatch";

/** collapsible agl systems section with papi and rel sub-groups. */
export function AglSystemsSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [papiOpen, setPapiOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between mb-1 text-left"
      >
        <p className="text-[10px] font-medium uppercase text-tv-text-muted text-left">
          {t("dashboard.aglSystems")}
        </p>
        <SectionChevron open={open} />
      </button>
      {open && (
        <div className="space-y-1">
          {/* papi sub-group */}
          <div>
            <button
              type="button"
              onClick={() => setPapiOpen(!papiOpen)}
              className="flex w-full items-center gap-2 py-0.5 text-xs text-tv-text-secondary"
            >
              <Swatch item={{ key: "papi", i18nKey: "dashboard.papiSystem", swatch: "rectangle", color: "#e91e90" }} />
              <span className="flex-1 text-left">{t("dashboard.papiSystem")}</span>
              <SectionChevron open={papiOpen} />
            </button>
            {papiOpen &&
              papiItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-2 py-0.5 pl-4 text-xs text-tv-text-secondary"
                >
                  <Swatch item={item} />
                  {t(item.i18nKey)}
                </div>
              ))}
          </div>

          {/* rel sub-group */}
          <div>
            <button
              type="button"
              onClick={() => setRelOpen(!relOpen)}
              className="flex w-full items-center gap-2 py-0.5 text-xs text-tv-text-secondary"
            >
              <Swatch item={{ key: "rel", i18nKey: "dashboard.relSystem", swatch: "rectangle", color: "#f7b32b" }} />
              <span className="flex-1 text-left">{t("dashboard.relSystem")}</span>
              <SectionChevron open={relOpen} />
            </button>
            {relOpen &&
              relItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-2 py-0.5 pl-4 text-xs text-tv-text-secondary"
                >
                  <Swatch item={item} />
                  {t(item.i18nKey)}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
