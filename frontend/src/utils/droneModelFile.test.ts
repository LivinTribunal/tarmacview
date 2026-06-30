import { describe, it, expect } from "vitest";
import { isValidModelFile } from "./droneModelFile";

function file(name: string): File {
  return new File(["x"], name);
}

describe("isValidModelFile", () => {
  it("accepts .glb and .gltf case-insensitively", () => {
    expect(isValidModelFile(file("drone.glb"))).toBe(true);
    expect(isValidModelFile(file("drone.GLTF"))).toBe(true);
  });

  it("rejects other extensions and extensionless names", () => {
    expect(isValidModelFile(file("drone.obj"))).toBe(false);
    expect(isValidModelFile(file("drone"))).toBe(false);
  });
});
