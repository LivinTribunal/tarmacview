import {
  Cartesian2,
  JulianDate,
  SceneTransforms,
  Viewer as CesiumViewerType,
  Entity as CesiumEntity,
} from "cesium";
import {
  DECLUTTER_PRIORITY,
  applyDeclutter,
  estimateLabelRect,
  type DeclutterItem,
} from "./labelDeclutter";

/** read a numeric property from an entity's PropertyBag, returning a default if
 * absent or non-numeric. resium passes plain objects which cesium converts into
 * ConstantProperty values - we go through getValue() to handle both shapes. */
function readNumericProperty(
  entity: CesiumEntity,
  key: string,
  defaultValue: number,
): number {
  const props = entity.properties;
  if (!props) return defaultValue;
  const raw = (props as unknown as Record<string, { getValue?: (t?: unknown) => unknown } | undefined>)[key];
  const value = raw?.getValue ? raw.getValue() : raw;
  return typeof value === "number" ? value : defaultValue;
}

/** read a string property from an entity's PropertyBag. */
function readStringProperty(entity: CesiumEntity, key: string): string | undefined {
  const props = entity.properties;
  if (!props) return undefined;
  const raw = (props as unknown as Record<string, { getValue?: (t?: unknown) => unknown } | undefined>)[key];
  const value = raw?.getValue ? raw.getValue() : raw;
  return typeof value === "string" ? value : undefined;
}

/** parse a `Npx` font spec to extract the numeric pixel size. defaults to 12. */
function fontPx(font: string | undefined): number {
  if (!font) return 12;
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number(match[1]) : 12;
}

/** project all label-bearing entities tagged with declutterPriority to screen
 * space, then call applyDeclutter so only the highest-priority label per overlap
 * cluster keeps label.show=true. selected entities get a priority boost so their
 * labels survive every collision. */
export function runDeclutterPass(viewer: CesiumViewerType, selectedKey: string | null): void {
  const time = viewer.clock.currentTime ?? JulianDate.now();
  const items: DeclutterItem[] = [];

  const collectFrom = (entities: { values: CesiumEntity[] }) => {
    for (const entity of entities.values) {
      const label = entity.label;
      if (!label) continue;
      const priorityBase = readNumericProperty(entity, "declutterPriority", -1);
      if (priorityBase < 0) continue;
      const position = entity.position?.getValue(time);
      if (!position) continue;

      const window = SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        position,
        new Cartesian2(),
      );
      if (!window) continue;

      const text = label.text?.getValue(time) ?? "";
      const font = label.font?.getValue(time);
      const offset = label.pixelOffset?.getValue(time);
      const rect = estimateLabelRect(
        String(text),
        fontPx(font),
        window.x,
        window.y,
        offset?.x ?? 0,
        offset?.y ?? 0,
      );

      const featureType = readStringProperty(entity, "featureType");
      const featureId = readStringProperty(entity, "featureId");
      const isSelected =
        selectedKey != null && featureType && featureId && `${featureType}:${featureId}` === selectedKey;
      const priority = isSelected ? priorityBase + DECLUTTER_PRIORITY.selectedBoost : priorityBase;

      items.push({
        id: String(entity.id),
        rect,
        priority,
        setVisible: (show: boolean) => {
          if (label.show) {
            // ConstantProperty exposes setValue at runtime; ConstantProperty<boolean>
            // also accepts plain boolean via `setValue`.
            const showProp = label.show as unknown as { setValue?: (v: boolean) => void };
            if (showProp.setValue) {
              showProp.setValue(show);
              return;
            }
          }
          label.show = show as unknown as typeof label.show;
        },
      });
    }
  };

  collectFrom(viewer.entities);
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const ds = viewer.dataSources.get(i);
    collectFrom(ds.entities);
  }

  applyDeclutter(items, 2);
}
