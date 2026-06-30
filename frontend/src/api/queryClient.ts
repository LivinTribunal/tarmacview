import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  airports: {
    summaries: () => ["airports", "summaries"] as const,
  },
  droneProfiles: {
    list: () => ["droneProfiles", "list"] as const,
  },
};
