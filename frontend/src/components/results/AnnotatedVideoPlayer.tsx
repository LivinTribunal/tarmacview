import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";

interface AnnotatedVideoPlayerProps {
  // object-storage key -> presigned video url
  videoUrls: Record<string, string>;
}

// the full-frame track that frames the whole runway - default + sizing reference
const COMBINED_TRACK = "all_papi_lights";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const tracks = Object.keys(videoUrls);
  // open on the full-frame combined track when present; the per-light crops are
  // tall and only make sense after the operator zooms into one
  const [active, setActive] = useState<string>(
    tracks.includes(COMBINED_TRACK) ? COMBINED_TRACK : (tracks[0] ?? ""),
  );

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
      <div className="flex flex-wrap items-center gap-2 mb-3">
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
        <button
          type="button"
          onClick={() => void videoRef.current?.requestFullscreen?.()}
          className="ml-auto flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium bg-tv-surface-hover text-tv-text-secondary hover:text-tv-text-primary"
          data-testid="video-fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          {t("results.video.fullscreen")}
        </button>
      </div>
      {/* fixed landscape box so the tall per-light crops letterbox inside the
          same frame as the full "all PAPI lights" track instead of blowing up */}
      <div className="mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-2xl bg-black">
        <video
          key={active}
          ref={videoRef}
          src={videoUrls[active]}
          controls
          className="h-full w-full object-contain"
          data-testid="annotated-video-element"
        >
          <track kind="captions" />
        </video>
      </div>
    </div>
  );
}
