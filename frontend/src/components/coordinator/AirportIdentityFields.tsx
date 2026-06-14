import { useTranslation } from "react-i18next";

import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import Button from "@/components/common/Button";
import {
  MIN_IMPORT_RADIUS_KM,
  MAX_IMPORT_RADIUS_KM,
} from "@/hooks/useAirportLookup";

interface AirportIdentityFieldsProps {
  icaoCode: string;
  onIcaoCodeChange: (v: string) => void;
  importRadius: string;
  onImportRadiusChange: (v: string) => void;
  name: string;
  onNameChange: (v: string) => void;
  city: string;
  onCityChange: (v: string) => void;
  country: string;
  onCountryChange: (v: string) => void;
  lat: string;
  onLatChange: (v: string) => void;
  lon: string;
  onLonChange: (v: string) => void;
  alt: string;
  onAltChange: (v: string) => void;
  errors: Record<string, string>;
  lookupError: string | null;
  lookupEmpty: boolean;
  looking: boolean;
  icaoValid: boolean;
  onLookup: () => void;
  onPickOnMap: () => void;
}

/** identity + location inputs for the create-airport dialog. */
export default function AirportIdentityFields({
  icaoCode,
  onIcaoCodeChange,
  importRadius,
  onImportRadiusChange,
  name,
  onNameChange,
  city,
  onCityChange,
  country,
  onCountryChange,
  lat,
  onLatChange,
  lon,
  onLonChange,
  alt,
  onAltChange,
  errors,
  lookupError,
  lookupEmpty,
  looking,
  icaoValid,
  onLookup,
  onPickOnMap,
}: AirportIdentityFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id="icao-code"
            label={t("coordinator.createAirport.icaoCode")}
            hint={t("coordinator.createAirport.icaoCodeHelp")}
            value={icaoCode}
            onChange={(e) => onIcaoCodeChange(e.target.value.toUpperCase().slice(0, 4))}
            placeholder={t("coordinator.createAirport.icaoCodePlaceholder")}
            maxLength={4}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={onLookup}
          disabled={!icaoValid || looking}
          data-testid="lookup-airport-button"
        >
          {looking
            ? t("coordinator.createAirport.lookup.looking")
            : t("coordinator.createAirport.lookup.button")}
        </Button>
      </div>
      <div>
        <Input
          id="import-radius"
          label={t("coordinator.createAirport.importRadius")}
          hint={t("coordinator.createAirport.importRadiusHelp")}
          type="number"
          min={String(MIN_IMPORT_RADIUS_KM)}
          max={String(MAX_IMPORT_RADIUS_KM)}
          step="0.5"
          value={importRadius}
          onChange={(e) => onImportRadiusChange(e.target.value)}
          data-testid="import-radius-input"
        />
        <p className="text-[10px] text-tv-text-muted mt-0.5">
          {t("coordinator.createAirport.importRadiusHint")}
        </p>
        {errors.importRadius && (
          <p className="text-xs text-tv-error mt-0.5" data-testid="radius-error">{errors.importRadius}</p>
        )}
      </div>
      {errors.icaoCode && (
        <p className="text-xs text-tv-error -mt-2" data-testid="icao-error">{errors.icaoCode}</p>
      )}
      {lookupError && (
        <p className="text-xs text-tv-error" data-testid="lookup-error">{lookupError}</p>
      )}
      {lookupEmpty && !lookupError && (
        <p className="text-xs text-tv-text-secondary" data-testid="lookup-empty">
          {t("coordinator.createAirport.lookup.noSuggestions")}
        </p>
      )}

      <Input
        id="airport-name"
        label={t("coordinator.createAirport.name")}
        hint={t("coordinator.createAirport.nameHelp")}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={t("coordinator.createAirport.namePlaceholder")}
      />
      {errors.name && (
        <p className="text-xs text-tv-error -mt-2">{errors.name}</p>
      )}

      <Input
        id="airport-city"
        label={t("coordinator.createAirport.city")}
        hint={t("coordinator.createAirport.cityHelp")}
        value={city}
        onChange={(e) => onCityChange(e.target.value)}
        placeholder={t("coordinator.createAirport.cityPlaceholder")}
      />

      <Input
        id="airport-country"
        label={t("coordinator.createAirport.country")}
        hint={t("coordinator.createAirport.countryHelp")}
        value={country}
        onChange={(e) => onCountryChange(e.target.value)}
        placeholder={t("coordinator.createAirport.countryPlaceholder")}
      />

      {/* location */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="flex items-center gap-1 text-xs font-medium text-tv-text-secondary">
            <span>{t("coordinator.createAirport.location")}</span>
            <InfoHint
              text={t("coordinator.createAirport.altitudeHelp")}
              label={t("coordinator.createAirport.location")}
              testId="hint-airport-location"
            />
          </span>
          <button
            type="button"
            onClick={onPickOnMap}
            className="text-xs text-tv-accent hover:underline"
            data-testid="pick-on-map-button"
          >
            {t("coordinator.createAirport.pickOnMap")}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Input
              id="airport-lat"
              label={t("coordinator.createAirport.latitude")}
              hint={t("coordinator.createAirport.latitudeHelp")}
              type="number"
              step="any"
              value={lat}
              onChange={(e) => onLatChange(e.target.value)}
            />
            {errors.lat && (
              <p className="text-xs text-tv-error mt-0.5">{errors.lat}</p>
            )}
          </div>
          <div>
            <Input
              id="airport-lon"
              label={t("coordinator.createAirport.longitude")}
              hint={t("coordinator.createAirport.longitudeHelp")}
              type="number"
              step="any"
              value={lon}
              onChange={(e) => onLonChange(e.target.value)}
            />
            {errors.lon && (
              <p className="text-xs text-tv-error mt-0.5">{errors.lon}</p>
            )}
          </div>
          <div>
            <Input
              id="airport-alt"
              label={t("coordinator.createAirport.altitude")}
              hint={t("coordinator.createAirport.altitudeHelp")}
              type="number"
              step="any"
              value={alt}
              onChange={(e) => onAltChange(e.target.value)}
            />
            {errors.alt && (
              <p className="text-xs text-tv-error mt-0.5">{errors.alt}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
