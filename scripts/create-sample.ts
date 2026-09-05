import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Jimp, rgbaToInt } from "jimp";

const width = 1600;
const height = 1200;
const output = new URL("../samples/paisaje-demo-original.jpg", import.meta.url);
const outputPath = fileURLToPath(output);

await mkdir(new URL("../samples/", import.meta.url), { recursive: true });

const image = new Jimp({ width, height, color: 0xffffffff });

image.scan((x, y, index) => {
  const horizon = Math.floor(height * 0.58);
  const isSky = y < horizon;
  const ratio = isSky ? y / horizon : (y - horizon) / (height - horizon);

  if (isSky) {
    image.bitmap.data[index] = Math.round(35 + 65 * ratio);
    image.bitmap.data[index + 1] = Math.round(125 + 75 * ratio);
    image.bitmap.data[index + 2] = Math.round(205 + 35 * ratio);
  } else {
    image.bitmap.data[index] = Math.round(22 + 28 * ratio);
    image.bitmap.data[index + 1] = Math.round(116 - 45 * ratio);
    image.bitmap.data[index + 2] = Math.round(76 - 30 * ratio);
  }
  image.bitmap.data[index + 3] = 255;
});

const sun = new Jimp({ width: 190, height: 190, color: rgbaToInt(255, 199, 55, 255) });
const lake = new Jimp({ width: 1120, height: 240, color: rgbaToInt(40, 140, 185, 255) });
const mountainLeft = new Jimp({ width: 650, height: 270, color: rgbaToInt(40, 89, 78, 255) });
const mountainRight = new Jimp({ width: 780, height: 320, color: rgbaToInt(30, 75, 68, 255) });

image.composite(sun, 1110, 115);
image.composite(mountainLeft, 70, 520);
image.composite(mountainRight, 690, 470);
image.composite(lake, 240, 765);

await image.write(outputPath as `${string}.${string}`);
console.log(`Muestra creada: ${outputPath} (${width}x${height})`);
