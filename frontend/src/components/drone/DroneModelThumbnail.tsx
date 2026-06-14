import { useEffect, useState } from "react";
import DronePlaceholderIcon from "./DronePlaceholderIcon";
import { renderToImage } from "./renderDroneThumbnail";

interface DroneModelThumbnailProps {
  modelUrl: string | null;
  size?: number;
  className?: string;
}

/** renders a cached thumbnail from a 3d model url. */
export default function DroneModelThumbnail({
  modelUrl,
  size = 128,
  className = "",
}: DroneModelThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!modelUrl) return;
    let cancelled = false;
    renderToImage(modelUrl, size)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [modelUrl, size]);

  if (!modelUrl || !src) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <DronePlaceholderIcon />
      </div>
    );
  }

  return <img src={src} alt="" className={`object-contain ${className}`} />;
}
