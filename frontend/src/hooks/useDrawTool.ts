import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";

export interface DrawToolShape {
  onClick(e: maplibregl.MapMouseEvent, map: maplibregl.Map): void;
  onMouseMove(e: maplibregl.MapMouseEvent, map: maplibregl.Map): void;
  onDblClick?(e: maplibregl.MapMouseEvent, map: maplibregl.Map): void;
  // clears refs + setIsDrawing(false) + the drawing sources
  reset(): void;
  // ensures the drawing sources/layers exist on the map
  ensure(): void;
}

/** shared draw-tool lifecycle: style-load guard, crosshair cursor, event wiring,
 * right-click cancel, and teardown. shapes own their refs/preview/geometry. */
export default function useDrawTool(
  map: maplibregl.Map | null,
  active: boolean,
  shape: DrawToolShape,
): void {
  const shapeRef = useRef(shape);
  shapeRef.current = shape;

  useEffect(() => {
    if (!map || !active) {
      if (map) shapeRef.current.reset();
      return;
    }

    const ensure = () => shapeRef.current.ensure();
    if (map.isStyleLoaded()) {
      ensure();
    } else {
      map.once("style.load", ensure);
    }

    map.getCanvas().style.cursor = "crosshair";

    function onClick(e: maplibregl.MapMouseEvent) {
      shapeRef.current.onClick(e, map!);
    }
    function onMouseMove(e: maplibregl.MapMouseEvent) {
      shapeRef.current.onMouseMove(e, map!);
    }
    function onDblClick(e: maplibregl.MapMouseEvent) {
      shapeRef.current.onDblClick?.(e, map!);
    }
    function onContextMenu(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      shapeRef.current.reset();
    }

    map.on("click", onClick);
    map.on("mousemove", onMouseMove);
    map.on("dblclick", onDblClick);
    map.on("contextmenu", onContextMenu);

    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMouseMove);
      map.off("dblclick", onDblClick);
      map.off("contextmenu", onContextMenu);
      map.getCanvas().style.cursor = "";
      shapeRef.current.reset();
    };
  }, [map, active]);
}
