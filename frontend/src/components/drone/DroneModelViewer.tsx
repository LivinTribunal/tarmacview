import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import DronePlaceholderIcon from "./DronePlaceholderIcon";
import useDroneScene from "./useDroneScene";

interface DroneModelViewerProps {
  modelUrl: string | null;
  autoRotate?: boolean;
  backgroundColor?: string;
  height?: string;
  onSceneLoaded?: (gltf: GLTF) => void;
}

/** 3d drone model viewer using three.js. */
export default function DroneModelViewer({
  modelUrl,
  autoRotate = true,
  backgroundColor = "transparent",
  height = "100%",
  onSceneLoaded,
}: DroneModelViewerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  const { loading, error } = useDroneScene({
    containerRef,
    modelUrl,
    autoRotate,
    backgroundColor,
    onSceneLoaded,
  });

  if (!modelUrl) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2"
        style={{ height }}
      >
        <DronePlaceholderIcon />
        <span className="text-xs text-[var(--tv-text-muted)]">
          {t("drone.noModel")}
        </span>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-[var(--tv-accent)] border-t-transparent animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <DronePlaceholderIcon />
          <span className="text-xs text-[var(--tv-text-muted)]">
            {t("drone.modelNotAvailable")}
          </span>
        </div>
      )}
    </div>
  );
}
