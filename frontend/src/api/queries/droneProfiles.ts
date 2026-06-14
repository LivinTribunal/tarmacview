import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../queryClient";
import { listDroneProfiles } from "../droneProfiles";

export function useDroneProfiles() {
  return useQuery({
    queryKey: queryKeys.droneProfiles.list(),
    queryFn: () => listDroneProfiles(),
    staleTime: 5 * 60_000,
  });
}
