import { describe, it, expect, beforeEach } from "vitest";
import type { InternalAxiosRequestConfig } from "axios";
import client from "./client";

// the client forces a default Content-Type of application/json; a FormData body
// must override that to multipart or axios json-stringifies the upload and the
// server gets no file fields (the photo-metadata / terrain-DEM 422).
describe("api client content-type shaping", () => {
  let contentType: string | undefined;

  beforeEach(() => {
    contentType = undefined;
    // stub the adapter so requests resolve locally; transformRequest runs before
    // the adapter, so config.headers reflects the final content-type axios sends.
    client.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const ct = config.headers.getContentType();
      contentType = typeof ct === "string" ? ct : undefined;
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
  });

  it("sends multipart/form-data for a FormData body", async () => {
    const fd = new FormData();
    fd.append("files", new Blob(["x"], { type: "image/jpeg" }), "x.jpg");
    await client.post("/airports/a1/extract-photo-metadata", fd);
    expect(contentType).toMatch(/^multipart\/form-data/);
  });

  it("keeps application/json for a plain-object body", async () => {
    await client.post("/missions", { name: "m" });
    expect(contentType).toContain("application/json");
  });
});
