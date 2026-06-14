import { useState, useEffect, useRef } from "react";
import { roundAlt } from "@/utils/coordRounding";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";

interface UseResolvedAltitudeArgs {
  effectiveEntityType: string;
  showAltInput: boolean;
  altResolveLat: number | null;
  altResolveLon: number | null;
  resolver?: ElevationResolver;
  airportElevation: number;
}

interface UseResolvedAltitude {
  manualAlt: string;
  altLoading: boolean;
  altFallback: boolean;
  handleAltChange: (value: string) => void;
}

/** auto-fills a point entity's altitude from the DEM resolver, frozen once the user edits it. */
export function useResolvedAltitude({
  effectiveEntityType,
  showAltInput,
  altResolveLat,
  altResolveLon,
  resolver,
  airportElevation,
}: UseResolvedAltitudeArgs): UseResolvedAltitude {
  // alt input auto-fills from DEM via resolver; userEditedAlt freezes manual edits
  const [manualAlt, setManualAlt] = useState("");
  const [userEditedAlt, setUserEditedAlt] = useState(false);
  const [altLoading, setAltLoading] = useState(false);
  const [altFallback, setAltFallback] = useState(false);
  const altRequestIdRef = useRef(0);

  // reset alt state when entity type changes - new entity, fresh lookup
  useEffect(() => {
    setManualAlt("");
    setUserEditedAlt(false);
    setAltFallback(false);
    setAltLoading(false);
    altRequestIdRef.current += 1;
  }, [effectiveEntityType]);

  // resolve elevation when position changes - last-write-wins via request id
  useEffect(() => {
    if (!showAltInput) return;
    if (userEditedAlt) return;
    if (altResolveLat == null || altResolveLon == null) return;
    const reqId = ++altRequestIdRef.current;
    if (!resolver) {
      setManualAlt(String(roundAlt(airportElevation)));
      setAltFallback(true);
      setAltLoading(false);
      return;
    }
    setAltLoading(true);
    resolver(altResolveLat, altResolveLon).then((v) => {
      if (reqId !== altRequestIdRef.current) return;
      if (v == null) {
        setManualAlt(String(roundAlt(airportElevation)));
        setAltFallback(true);
      } else {
        setManualAlt(String(roundAlt(v)));
        setAltFallback(false);
      }
      setAltLoading(false);
    });
  }, [showAltInput, userEditedAlt, altResolveLat, altResolveLon, resolver, airportElevation]);

  function handleAltChange(value: string) {
    /** user typed in the alt input - freeze it from future resolver overwrites. */
    setManualAlt(value);
    setUserEditedAlt(true);
    setAltFallback(false);
    setAltLoading(false);
  }

  return { manualAlt, altLoading, altFallback, handleAltChange };
}
