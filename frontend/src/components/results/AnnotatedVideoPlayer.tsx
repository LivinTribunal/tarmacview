import { useState } from "react";
import { useTranslation } from "react-i18next";

interface AnnotatedVideoPlayerProps {
  // object-storage key -> presigned video url
  videoUrls: Record<string, string>;
}

// friendlier labels for the engine's annotated-video keys
const TRACK_LABELS: Record<string, string> = {
  enhanced: "results.video.enhanced",
  all_papi_lights: "results.video.combined",
};

/** annotated-video player with a track selector across the per-light outputs. */
export default function AnnotatedVideoPlayer({
  videoUrls,
}: AnnotatedVideoPlayerProps) {
  const { t } = useTranslation();
  const tracks = Object.keys(videoUrls);
  const [active, setActive] = useState<string>(tracks[0] ?? "");

  if (tracks.length === 0) {
    return (
      <p className="text-sm text-tv-text-muted py-6 text-center">
        {t("results.video.empty")}
      </p>
    );
  }

  const label = (key: string) =>
    TRACK_LABELS[key] ? t(TRACK_LABELS[key]) : key.replace(/_/g, " ");

  return (
    <div data-testid="annotated-video-player">
      <div className="flex flex-wrap gap-2 mb-3">
        {tracks.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
              key === active
                ? "bg-tv-accent text-tv-accent-text"
                : "bg-tv-surface-hover text-tv-text-secondary hover:text-tv-text-primary"
            }`}
          >
            {label(key)}
          </button>
        ))}
      </div>
      <video
        key={active}
        src={videoUrls[active]}
        controls
        className="w-full rounded-2xl bg-black"
        data-testid="annotated-video-element"
      >
        <track kind="captions" />
      </video>
    </div>
  );
}
