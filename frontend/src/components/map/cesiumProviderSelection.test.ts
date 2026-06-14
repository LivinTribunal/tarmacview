import { describe, expect, it } from "vitest";
import {
  pickTerrainConfig,
  pickImageryConfig,
} from "./cesiumProviderSelection";

describe("pickTerrainConfig", () => {
  it("returns ion when url is undefined", () => {
    expect(pickTerrainConfig(undefined)).toEqual({ kind: "ion" });
  });

  it("returns ion when url is empty string", () => {
    expect(pickTerrainConfig("")).toEqual({ kind: "ion" });
  });

  it("returns url config when a url is set", () => {
    expect(pickTerrainConfig("https://terrain.example/internal")).toEqual({
      kind: "url",
      url: "https://terrain.example/internal",
    });
  });
});

describe("pickImageryConfig", () => {
  it("returns ion when url is undefined", () => {
    expect(pickImageryConfig(undefined)).toEqual({ kind: "ion" });
  });

  it("returns ion when url is empty string", () => {
    expect(pickImageryConfig("")).toEqual({ kind: "ion" });
  });

  it("returns url config when a url is set", () => {
    expect(
      pickImageryConfig("https://tiles.example/sat/{z}/{x}/{y}.png"),
    ).toEqual({
      kind: "url",
      url: "https://tiles.example/sat/{z}/{x}/{y}.png",
    });
  });
});
