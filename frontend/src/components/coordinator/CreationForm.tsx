import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import RunwayFields from "./creationFields/RunwayFields";
import SafetyZoneFields from "./creationFields/SafetyZoneFields";
import ObstacleFields from "./creationFields/ObstacleFields";
import AglFields from "./creationFields/AglFields";
import LhaFields from "./creationFields/LhaFields";
import {
  OBSTACLE_SUBTYPES,
  SAFETY_ZONE_SUBTYPES,
  SURFACE_SUBTYPES,
} from "./utils/creationFormConstants";
import { useCreationFormState, type CreationFormProps } from "./hooks/useCreationFormState";

export type { PendingGeometryType, EntityType } from "./utils/creationFormConstants";

export default function CreationForm(props: CreationFormProps) {
  /** creation form shown after drawing a geometry - two-tier type selection, fill fields, create entity. */
  const { t } = useTranslation();
  const {
    surfaces,
    onCancel,
    circleCenter,
    pointPosition,
    prefilledArea,
    pickingTouchpoint = false,
    onPickTouchpointToggle,
    pickingThreshold = false,
    onPickThresholdToggle,
    pickingEnd = false,
    onPickEndToggle,
  } = props;
  const {
    category,
    handleCategoryChange,
    entityType,
    setEntityType,
    obstacleType,
    setObstacleType,
    effectiveEntityType,
    name,
    setName,
    namePlaceholder,
    heading,
    setHeading,
    length,
    setLength,
    width,
    setWidth,
    touchpointLat,
    setTouchpointLat,
    touchpointLon,
    setTouchpointLon,
    touchpointAlt,
    setTouchpointAlt,
    altFloor,
    setAltFloor,
    altCeiling,
    setAltCeiling,
    isActive,
    setIsActive,
    obstacleHeight,
    setObstacleHeight,
    bufferDistance,
    setBufferDistance,
    surfaceId,
    setSurfaceId,
    aglType,
    setAglType,
    aglSide,
    setAglSide,
    glideSlopeAngle,
    setGlideSlopeAngle,
    glideSlopeAngleTolerance,
    setGlideSlopeAngleTolerance,
    distFromThreshold,
    handleDistFromThresholdChange,
    thresholdLat,
    setThresholdLat,
    thresholdLon,
    setThresholdLon,
    thresholdAlt,
    setThresholdAlt,
    endLat,
    setEndLat,
    endLon,
    setEndLon,
    endAlt,
    setEndAlt,
    swapThresholdEnd,
    manualLat,
    setManualLat,
    manualLon,
    setManualLon,
    lhaAglId,
    setLhaAglId,
    lhaSettingAngle,
    setLhaSettingAngle,
    lhaLampType,
    setLhaLampType,
    lhaTolerance,
    setLhaTolerance,
    lhaLensMsl,
    setLhaLensMsl,
    lhaLensAgl,
    setLhaLensAgl,
    isPapiAgl,
    allAgls,
    nextDesignator,
    papiSlotsExhausted,
    categoryOptions,
    needsSubtype,
    isSafetyZone,
    isAirportBoundary,
    safetyZoneTypeLabel,
    prefilledBoundary,
    obstacleHasSinglePoint,
    manualAlt,
    altLoading,
    altFallback,
    handleAltChange,
    error,
    submitting,
    canSubmit,
    handleSubmit,
  } = useCreationFormState(props, t);

  return (
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg p-3"
      data-testid="creation-form"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="rounded-full px-3 py-1 bg-tv-surface border border-tv-border text-xs font-semibold text-tv-text-primary">
          {t("coordinator.creation.title")}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full p-1 text-tv-text-muted hover:text-tv-text-primary transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 [&_input]:!px-3 [&_input]:!py-1.5 [&_input]:!text-xs">
        {/* tier 1 - category selection (hidden for prefilled airport boundary) */}
        {!prefilledBoundary && (
        <div>
          <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
            <span>{t("coordinator.creation.selectCategory")}</span>
            <InfoHint
              text={t("coordinator.creation.selectCategoryHelp")}
              label={t("coordinator.creation.selectCategory")}
              testId="hint-creation-category"
            />
          </label>
          <select
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="creation-category-select"
          >
            <option value="">{t("coordinator.creation.selectCategory")}</option>
            {categoryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
        )}

        {/* tier 2 - subtype selection (for surface and safety_zone) */}
        {!prefilledBoundary && needsSubtype && category && (
          <div>
            <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
              <span>{t("coordinator.creation.selectType")}</span>
              <InfoHint
                text={t("coordinator.creation.selectTypeHelp")}
                label={t("coordinator.creation.selectType")}
                testId="hint-creation-type"
              />
            </label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as typeof entityType)}
              className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="creation-type-select"
            >
              <option value="">{t("coordinator.creation.selectType")}</option>
              {(category === "surface" ? SURFACE_SUBTYPES : SAFETY_ZONE_SUBTYPES).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* obstacle subtype - shown inline since category directly maps to entity */}
        {category === "obstacle" && (
          <div>
            <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
              <span>{t("coordinator.creation.obstacleType")}</span>
              <InfoHint
                text={t("coordinator.creation.obstacleTypeHelp")}
                label={t("coordinator.creation.obstacleType")}
                testId="hint-creation-obstacle-type"
              />
            </label>
            <select
              value={obstacleType}
              onChange={(e) => setObstacleType(e.target.value)}
              className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
            >
              {OBSTACLE_SUBTYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        )}

        {effectiveEntityType && (
          <>
            {/* name - always required, auto-assigned (and hidden) for airport boundary */}
            {!isAirportBoundary && (
              <Input
                id="create-name"
                label={category === "surface" ? t("coordinator.detail.surfaceIdentifier") : t("coordinator.detail.obstacleName")}
                hint={category === "surface" ? t("coordinator.detail.surfaceIdentifierHelp") : t("coordinator.detail.obstacleNameHelp")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={namePlaceholder()}
              />
            )}

            {/* runway / taxiway fields */}
            {(effectiveEntityType === "runway" || effectiveEntityType === "taxiway") && (
              <RunwayFields
                isRunway={effectiveEntityType === "runway"}
                heading={heading}
                setHeading={setHeading}
                length={length}
                setLength={setLength}
                width={width}
                setWidth={setWidth}
                touchpointLat={touchpointLat}
                setTouchpointLat={setTouchpointLat}
                touchpointLon={touchpointLon}
                setTouchpointLon={setTouchpointLon}
                touchpointAlt={touchpointAlt}
                setTouchpointAlt={setTouchpointAlt}
                pickingTouchpoint={pickingTouchpoint}
                onPickTouchpointToggle={onPickTouchpointToggle}
                thresholdLat={thresholdLat}
                setThresholdLat={setThresholdLat}
                thresholdLon={thresholdLon}
                setThresholdLon={setThresholdLon}
                thresholdAlt={thresholdAlt}
                setThresholdAlt={setThresholdAlt}
                endLat={endLat}
                setEndLat={setEndLat}
                endLon={endLon}
                setEndLon={setEndLon}
                endAlt={endAlt}
                setEndAlt={setEndAlt}
                pickingThreshold={pickingThreshold}
                onPickThresholdToggle={onPickThresholdToggle}
                pickingEnd={pickingEnd}
                onPickEndToggle={onPickEndToggle}
                onSwapThresholdEnd={swapThresholdEnd}
              />
            )}

            {/* safety zone fields */}
            {isSafetyZone && (
              <SafetyZoneFields
                isAirportBoundary={isAirportBoundary}
                safetyZoneTypeLabel={safetyZoneTypeLabel}
                altFloor={altFloor}
                setAltFloor={setAltFloor}
                altCeiling={altCeiling}
                setAltCeiling={setAltCeiling}
                isActive={isActive}
                setIsActive={setIsActive}
                prefilledArea={prefilledArea}
              />
            )}

            {/* obstacle fields */}
            {effectiveEntityType === "obstacle" && (
              <ObstacleFields
                obstacleHeight={obstacleHeight}
                setObstacleHeight={setObstacleHeight}
                bufferDistance={bufferDistance}
                setBufferDistance={setBufferDistance}
                circleCenter={circleCenter}
                pointPosition={pointPosition}
                obstacleHasSinglePoint={obstacleHasSinglePoint}
                altLoading={altLoading}
                manualAlt={manualAlt}
                handleAltChange={handleAltChange}
                altFallback={altFallback}
                prefilledArea={prefilledArea}
              />
            )}

            {/* agl fields */}
            {effectiveEntityType === "agl" && (
              <AglFields
                surfaces={surfaces}
                surfaceId={surfaceId}
                setSurfaceId={setSurfaceId}
                aglType={aglType}
                setAglType={setAglType}
                aglSide={aglSide}
                setAglSide={setAglSide}
                glideSlopeAngle={glideSlopeAngle}
                setGlideSlopeAngle={setGlideSlopeAngle}
                glideSlopeAngleTolerance={glideSlopeAngleTolerance}
                setGlideSlopeAngleTolerance={setGlideSlopeAngleTolerance}
                distFromThreshold={distFromThreshold}
                onDistFromThresholdChange={handleDistFromThresholdChange}
                manualLat={manualLat}
                setManualLat={setManualLat}
                manualLon={manualLon}
                setManualLon={setManualLon}
                altLoading={altLoading}
                manualAlt={manualAlt}
                handleAltChange={handleAltChange}
                altFallback={altFallback}
              />
            )}

            {/* lha fields */}
            {effectiveEntityType === "lha" && (
              <LhaFields
                allAgls={allAgls}
                lhaAglId={lhaAglId}
                setLhaAglId={setLhaAglId}
                papiSlotsExhausted={papiSlotsExhausted}
                nextDesignator={nextDesignator}
                lhaSettingAngle={lhaSettingAngle}
                setLhaSettingAngle={setLhaSettingAngle}
                lhaLampType={lhaLampType}
                setLhaLampType={setLhaLampType}
                lhaTolerance={lhaTolerance}
                setLhaTolerance={setLhaTolerance}
                isPapi={isPapiAgl}
                lhaLensMsl={lhaLensMsl}
                setLhaLensMsl={setLhaLensMsl}
                lhaLensAgl={lhaLensAgl}
                setLhaLensAgl={setLhaLensAgl}
                manualLat={manualLat}
                setManualLat={setManualLat}
                manualLon={manualLon}
                setManualLon={setManualLon}
                altLoading={altLoading}
                manualAlt={manualAlt}
                handleAltChange={handleAltChange}
                altFallback={altFallback}
              />
            )}

            {error && (
              <p className="text-xs text-tv-error">{error}</p>
            )}

            {/* action buttons */}
            <div className="flex gap-1.5 mt-1">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !canSubmit}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  submitting || !canSubmit
                    ? "bg-tv-surface text-tv-text-muted cursor-not-allowed"
                    : "bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover"
                }`}
                data-testid="creation-submit"
              >
                {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                {t("coordinator.tools.create")}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-1.5 rounded-full text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
