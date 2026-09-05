import { describe, expect, it } from "vitest";
import {
  buildOutputKey,
  decodeS3Key,
  getImageMime,
  normalizePrefix,
  parseDimension,
  readConfiguration,
} from "../src/index.js";

describe("configuración", () => {
  it("aplica valores predeterminados", () => {
    expect(readConfiguration({})).toEqual({
      width: 800,
      height: 600,
      inputPrefix: "originals/",
      outputPrefix: "resized/",
    });
  });

  it("acepta dimensiones configurables", () => {
    expect(
      readConfiguration({
        OUTPUT_WIDTH: "640",
        OUTPUT_HEIGHT: "480",
        INPUT_PREFIX: "/entrada/",
        OUTPUT_PREFIX: "/salida/",
      }),
    ).toEqual({
      width: 640,
      height: 480,
      inputPrefix: "entrada/",
      outputPrefix: "salida/",
    });
  });

  it("rechaza dimensiones inválidas y prefijos iguales", () => {
    expect(() => parseDimension("0", 800, "WIDTH")).toThrow();
    expect(() => parseDimension("12.5", 800, "WIDTH")).toThrow();
    expect(() =>
      readConfiguration({ INPUT_PREFIX: "images", OUTPUT_PREFIX: "images/" }),
    ).toThrow();
  });
});

describe("claves S3", () => {
  const configuration = {
    width: 800,
    height: 600,
    inputPrefix: "originals/",
    outputPrefix: "resized/",
  };

  it("decodifica espacios y caracteres UTF-8", () => {
    expect(decodeS3Key("originals/foto+de+Guatemala-%C3%B1.jpg")).toBe(
      "originals/foto de Guatemala-ñ.jpg",
    );
  });

  it("produce un nombre determinista relacionado al original", () => {
    expect(buildOutputKey("originals/viaje/lago.jpg", configuration)).toBe(
      "resized/viaje/lago-800x600.jpg",
    );
  });

  it("conserva PNG y reconoce formatos compatibles", () => {
    expect(buildOutputKey("originals/logo.PNG", configuration)).toBe(
      "resized/logo-800x600.png",
    );
    expect(getImageMime("foto.jpeg")).toBe("image/jpeg");
    expect(getImageMime("logo.png")).toBe("image/png");
    expect(getImageMime("documento.pdf")).toBeNull();
    expect(normalizePrefix("/originals//")).toBe("originals/");
  });
});

