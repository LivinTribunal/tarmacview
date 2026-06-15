// shared UI timing constants. wherever a magic number governs how long a
// toast hangs around or how often autosave fires, prefer importing from
// here so design system tweaks land in a single place.

export const NOTIFICATION_TIMEOUT_MS = 3000;
export const SLOW_NOTIFICATION_TIMEOUT_MS = 4000;
export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const AUTOSAVE_INTERVAL_MS = 30_000;
export const FIELD_LINK_POLL_INTERVAL_MS = 10_000;
export const MEASUREMENT_POLL_INTERVAL_MS = 4000;

// one day in milliseconds - used for relative day bucketing
export const MS_PER_DAY = 86_400_000;
