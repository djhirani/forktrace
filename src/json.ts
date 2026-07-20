import type { JsonObject } from "./types.js";

export function assertJsonRoundTrip<T>(value: T): T {
  assertJsonValue(value);
  const encoded = JSON.stringify(value);
  const decoded: unknown = JSON.parse(encoded);
  if (JSON.stringify(decoded) !== encoded)
    throw new TypeError("Value loses data during JSON round trip");
  return decoded as T;
}

function assertJsonValue(value: unknown, path = "$"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`${path} is not a finite JSON number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertJsonValue(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value))
      assertJsonValue(item, `${path}.${key}`);
    return;
  }
  throw new TypeError(`${path} is not JSON serializable without data loss`);
}

export function snapshotContext(context: JsonObject): JsonObject {
  return assertJsonRoundTrip(context);
}
