import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../queryClient";
import { listAirportSummaries } from "../airports";

export function useAirportSummaries() {
  return useQuery({
    queryKey: queryKeys.airports.summaries(),
    queryFn: () => listAirportSummaries(),
    staleTime: 5 * 60_000,
  });
}
