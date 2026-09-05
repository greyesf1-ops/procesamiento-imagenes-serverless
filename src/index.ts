import type { S3Event, S3EventRecord } from "aws-lambda";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Jimp } from "jimp";
import path from "node:path";

const s3 = new S3Client({});

export type SupportedMime = "image/jpeg" | "image/png";

export interface ResizeConfiguration {
  width: number;
  height: number;
  inputPrefix: string;
  outputPrefix: string;
}

export function parseDimension(
  rawValue: string | undefined,
  fallback: number,
  name: string,
): number {
  const value = rawValue === undefined ? fallback : Number(rawValue);

  if (!Number.isInteger(value) || value < 1 || value > 4096) {
    throw new Error(`${name} debe ser un entero entre 1 y 4096`);
  }

  return value;
}

export function normalizePrefix(value: string): string {
  const normalized = value.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized.length > 0 ? `${normalized}/` : "";
}

export function readConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ResizeConfiguration {
  const configuration = {
    width: parseDimension(environment.OUTPUT_WIDTH, 800, "OUTPUT_WIDTH"),
    height: parseDimension(environment.OUTPUT_HEIGHT, 600, "OUTPUT_HEIGHT"),
    inputPrefix: normalizePrefix(environment.INPUT_PREFIX ?? "originals/"),
    outputPrefix: normalizePrefix(environment.OUTPUT_PREFIX ?? "resized/"),
  };

  if (configuration.inputPrefix === configuration.outputPrefix) {
    throw new Error("INPUT_PREFIX y OUTPUT_PREFIX deben ser diferentes");
  }

  return configuration;
}

export function decodeS3Key(encodedKey: string): string {
  return decodeURIComponent(encodedKey.replace(/\+/g, " "));
}

export function getImageMime(key: string): SupportedMime | null {
  const extension = path.posix.extname(key).toLowerCase();

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".png") {
    return "image/png";
  }

  return null;
}

export function buildOutputKey(
  inputKey: string,
  configuration: ResizeConfiguration,
): string {
  if (!inputKey.startsWith(configuration.inputPrefix)) {
    throw new Error(`La clave no pertenece a ${configuration.inputPrefix}`);
  }

  const relativeKey = inputKey.slice(configuration.inputPrefix.length);
  const originalExtension = path.posix.extname(relativeKey);
  const extension = originalExtension.toLowerCase();
  const directory = path.posix.dirname(relativeKey);
  const baseName = path.posix.basename(relativeKey, originalExtension);
  const resizedName = `${baseName}-${configuration.width}x${configuration.height}${extension}`;
  const relativeOutput = directory === "." ? resizedName : `${directory}/${resizedName}`;

  return `${configuration.outputPrefix}${relativeOutput}`;
}

function cleanETag(eTag: string | undefined): string {
  return (eTag ?? "unknown").replace(/[\"']/g, "");
}

async function processRecord(
  record: S3EventRecord,
  configuration: ResizeConfiguration,
): Promise<void> {
  const bucket = record.s3.bucket.name;
  const inputKey = decodeS3Key(record.s3.object.key);
  const sourceETag = cleanETag(record.s3.object.eTag);

  if (
    !inputKey.startsWith(configuration.inputPrefix) ||
    inputKey.startsWith(configuration.outputPrefix)
  ) {
    console.info(
      JSON.stringify({
        status: "ignored",
        reason: "key_outside_input_prefix",
        bucket,
        inputKey,
      }),
    );
    return;
  }

  const contentType = getImageMime(inputKey);
  if (contentType === null) {
    console.info(
      JSON.stringify({
        status: "ignored",
        reason: "unsupported_extension",
        bucket,
        inputKey,
      }),
    );
    return;
  }

  const outputKey = buildOutputKey(inputKey, configuration);

  try {
    const currentOutput = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: outputKey }),
    );
    const metadata = currentOutput.Metadata ?? {};

    if (
      metadata["source-etag"] === sourceETag &&
      metadata.width === String(configuration.width) &&
      metadata.height === String(configuration.height)
    ) {
      console.info(
        JSON.stringify({
          status: "already_processed",
          bucket,
          inputKey,
          outputKey,
          sourceETag,
        }),
      );
      return;
    }
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (statusCode !== 404 && statusCode !== 403) {
      throw error;
    }
  }

  console.info(
    JSON.stringify({
      status: "processing",
      bucket,
      inputKey,
      outputKey,
      target: {
        width: configuration.width,
        height: configuration.height,
      },
      eventName: record.eventName,
    }),
  );

  const source = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: inputKey }),
  );
  if (source.Body === undefined) {
    throw new Error(`S3 devolvió un cuerpo vacío para ${inputKey}`);
  }

  const sourceBytes = Buffer.from(await source.Body.transformToByteArray());
  const image = await Jimp.read(sourceBytes);
  const originalWidth = image.width;
  const originalHeight = image.height;

  image.resize({ w: configuration.width, h: configuration.height });
  const resizedBytes = await image.getBuffer(contentType);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: outputKey,
      Body: resizedBytes,
      ContentType: contentType,
      Metadata: {
        "source-etag": sourceETag,
        "source-key": encodeURIComponent(inputKey),
        width: String(configuration.width),
        height: String(configuration.height),
      },
    }),
  );

  console.info(
    JSON.stringify({
      status: "success",
      bucket,
      inputKey,
      outputKey,
      contentType,
      original: { width: originalWidth, height: originalHeight },
      resized: { width: image.width, height: image.height },
      sourceBytes: sourceBytes.length,
      resizedBytes: resizedBytes.length,
    }),
  );
}

export async function handler(event: S3Event): Promise<void> {
  const configuration = readConfiguration();
  console.info(
    JSON.stringify({
      status: "invocation_started",
      records: event.Records.length,
      configuration,
    }),
  );

  await Promise.all(
    event.Records.map((record) => processRecord(record, configuration)),
  );
}
