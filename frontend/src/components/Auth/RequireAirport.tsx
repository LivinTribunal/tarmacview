import { Navigate, Outlet } from "react-router";
import { useAirport } from "@/contexts/AirportContext";

/** route guard: redirect to dashboard when no airport is selected. */
export default function RequireAirport() {
  const { selectedAirport } = useAirport();
  if (!selectedAirport) {
    return <Navigate to="/operator-center/dashboard" replace />;
  }
  return <Outlet />;
}
