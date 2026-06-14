import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import MapCoordinatePicker from "./MapCoordinatePicker";
import AirportIdentityFields from "./AirportIdentityFields";
import SuggestionSection from "./SuggestionSection";
import { createAirport } from "@/api/airports";
import { isAxiosError } from "@/api/client";
import useAirportLookup, { ICAO_REGEX } from "@/hooks/useAirportLookup";
import { DEFAULT_RADIUS } from "@/constants/infrastructureDefaults";
import { LAT_BOUNDS, LON_BOUNDS } from "@/constants/geo";

interface CreateAirportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export default function CreateAirportDialog({
  isOpen,
  onClose,
  onCreated,
}: CreateAirportDialogProps) {
  /** modal form to create a new airport with validation and openaip lookup. */
  const { t } = useTranslation();
  const [icaoCode, setIcaoCode] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [alt, setAlt] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [importRadius, setImportRadius] = useState(DEFAULT_RADIUS);
  const [createdAirportId, setCreatedAirportId] = useState<string | null>(null);

  const lookup = useAirportLookup({
    isOpen,
    icaoCode,
    importRadius,
    setErrors,
    t,
    setName,
    setCity,
    setCountry,
    setLat,
    setLon,
    setAlt,
  });

  useEffect(() => {
    if (isOpen) {
      setIcaoCode("");
      setName("");
      setCity("");
      setCountry("");
      setLat("");
      setLon("");
      setAlt("");
      setImportRadius(DEFAULT_RADIUS);
      setErrors({});
      setCreatedAirportId(null);
    }
  }, [isOpen]);

  function validate(): boolean {
    /** validate form fields, return true if valid. */
    const errs: Record<string, string> = {};
    if (!ICAO_REGEX.test(icaoCode)) {
      errs.icaoCode = t("coordinator.createAirport.icaoRequired");
    }
    if (!name.trim()) {
      errs.name = t("coordinator.createAirport.nameRequired");
    }
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    if (!lat.trim() || isNaN(parsedLat) || parsedLat < LAT_BOUNDS.min || parsedLat > LAT_BOUNDS.max) {
      errs.lat = t("coordinator.createAirport.latRequired");
    }
    if (!lon.trim() || isNaN(parsedLon) || parsedLon < LON_BOUNDS.min || parsedLon > LON_BOUNDS.max) {
      errs.lon = t("coordinator.createAirport.lonRequired");
    }
    if (!alt.trim() || isNaN(parseFloat(alt))) {
      errs.alt = t("coordinator.createAirport.altRequired");
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    /** submit the create airport form. */
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await createAirport({
        icao_code: icaoCode,
        name: name.trim(),
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        elevation: parseFloat(alt) || 0,
        location: {
          type: "Point",
          coordinates: [parseFloat(lon) || 0, parseFloat(lat) || 0, parseFloat(alt) || 0],
        },
      });

      const failedCount = await lookup.createCheckedSuggestions(result.id);
      if (failedCount > 0) {
        // keep the modal open so the user sees which items failed; they can dismiss to proceed.
        setErrors({
          form: t("coordinator.createAirport.lookup.partialFailure", {
            count: failedCount,
          }),
        });
        setCreatedAirportId(result.id);
        return;
      }

      onCreated(result.id);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        setErrors({ icaoCode: t("coordinator.createAirport.icaoConflict") });
      } else {
        setErrors({ form: t("coordinator.createAirport.createError") });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleMapPick(coords: { lat: number; lon: number; alt: number }) {
    /** set coordinates from map picker. */
    setLat(coords.lat.toFixed(6));
    setLon(coords.lon.toFixed(6));
    setAlt(coords.alt.toFixed(1));
    setShowMapPicker(false);
  }

  const icaoValid = ICAO_REGEX.test(icaoCode);
  const { suggestions, expanded } = lookup;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={t("coordinator.createAirport.title")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="create-airport-form">
          <AirportIdentityFields
            icaoCode={icaoCode}
            onIcaoCodeChange={setIcaoCode}
            importRadius={importRadius}
            onImportRadiusChange={setImportRadius}
            name={name}
            onNameChange={setName}
            city={city}
            onCityChange={setCity}
            country={country}
            onCountryChange={setCountry}
            lat={lat}
            onLatChange={setLat}
            lon={lon}
            onLonChange={setLon}
            alt={alt}
            onAltChange={setAlt}
            errors={errors}
            lookupError={lookup.lookupError}
            lookupEmpty={lookup.lookupEmpty}
            looking={lookup.looking}
            icaoValid={icaoValid}
            onLookup={lookup.handleLookup}
            onPickOnMap={() => setShowMapPicker(true)}
          />

          {/* suggestion preview */}
          {suggestions &&
            (suggestions.runways.length > 0 ||
              suggestions.obstacles.length > 0 ||
              suggestions.safetyZones.length > 0) && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-tv-text-secondary">
                    {t("coordinator.createAirport.lookup.previewTitle")}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => lookup.setAllChecked(true)}
                      className="text-tv-accent hover:underline"
                    >
                      {t("coordinator.createAirport.lookup.selectAll")}
                    </button>
                    <span className="text-tv-text-secondary">|</span>
                    <button
                      type="button"
                      onClick={() => lookup.setAllChecked(false)}
                      className="text-tv-accent hover:underline"
                    >
                      {t("coordinator.createAirport.lookup.deselectAll")}
                    </button>
                  </div>
                </div>
                <div
                  className="border border-tv-border rounded p-2 flex flex-col gap-2 max-h-64 overflow-y-auto"
                  data-testid="lookup-suggestions"
                >
                {suggestions.runways.length > 0 && (
                  <SuggestionSection
                    title={t("coordinator.createAirport.lookup.runways")}
                    count={suggestions.runways.length}
                    items={suggestions.runways}
                    expanded={expanded.runways}
                    testIdPrefix="runway-suggestion"
                    keyPrefix="rw"
                    onToggleSection={() => lookup.toggleSection("runways")}
                    onSetSectionChecked={(c) => lookup.setSectionChecked("runways", c)}
                    onToggleItem={lookup.toggleRunway}
                    renderItem={(r) => (
                      <>
                        {r.identifier} ({r.length.toFixed(0)}m x {r.width.toFixed(0)}m)
                      </>
                    )}
                  />
                )}

                {suggestions.safetyZones.length > 0 && (
                  <SuggestionSection
                    title={t("coordinator.createAirport.lookup.safetyZones")}
                    count={suggestions.safetyZones.length}
                    items={suggestions.safetyZones}
                    expanded={expanded.safetyZones}
                    testIdPrefix="safety-zone-suggestion"
                    keyPrefix="sz"
                    onToggleSection={() => lookup.toggleSection("safetyZones")}
                    onSetSectionChecked={(c) => lookup.setSectionChecked("safetyZones", c)}
                    onToggleItem={lookup.toggleSafetyZone}
                    renderItem={(z) => (
                      <>
                        {z.type} {z.name}
                      </>
                    )}
                  />
                )}

                {suggestions.obstacles.length > 0 && (
                  <SuggestionSection
                    title={t("coordinator.createAirport.lookup.obstacles")}
                    count={suggestions.obstacles.length}
                    items={suggestions.obstacles}
                    expanded={expanded.obstacles}
                    testIdPrefix="obstacle-suggestion"
                    keyPrefix="ob"
                    onToggleSection={() => lookup.toggleSection("obstacles")}
                    onSetSectionChecked={(c) => lookup.setSectionChecked("obstacles", c)}
                    onToggleItem={lookup.toggleObstacle}
                    renderItem={(o) => (
                      <>
                        {o.type} {o.name} ({o.height.toFixed(0)}m)
                      </>
                    )}
                  />
                )}
                </div>
              </div>
            )}

          {errors.form && (
            <p className="text-xs text-tv-error">{errors.form}</p>
          )}

          <div className="flex justify-end gap-2 mt-2">
            {createdAirportId ? (
              <Button
                type="button"
                onClick={() => onCreated(createdAirportId)}
                data-testid="continue-after-partial-failure"
              >
                {t("common.continue")}
              </Button>
            ) : (
              <>
                <Button variant="secondary" type="button" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? t("coordinator.createAirport.adding") : t("coordinator.createAirport.add")}
                </Button>
              </>
            )}
          </div>
        </form>
      </Modal>

      {showMapPicker && (
        <MapCoordinatePicker
          onConfirm={handleMapPick}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </>
  );
}
