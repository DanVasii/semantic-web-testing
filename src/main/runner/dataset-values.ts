import type {
  DatasetPrimitive,
  DatasetValue,
  TestDataset,
} from "../../shared/test-model.js";

export interface DatasetMaterializerOptions {
  createId: () => string;
  now: () => Date;
  random: () => number;
}

const formatDate = (date: Date, format?: string): string => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return (format ?? "YYYY-MM-DD")
    .replaceAll("YYYY", year)
    .replaceAll("MM", month)
    .replaceAll("DD", day)
    .replaceAll("HH", hours)
    .replaceAll("mm", minutes)
    .replaceAll("ss", seconds);
};

const primitiveText = (value: DatasetPrimitive): string =>
  value === null ? "" : String(value);

export const materializeDatasetValue = (
  value: DatasetValue,
  options: DatasetMaterializerOptions,
): DatasetPrimitive => {
  if (value === null || typeof value !== "object") return value;
  if (value.type === "fixed") return value.value;
  if (value.type === "file") return value.path;

  switch (value.strategy) {
    case "timestamp":
      return String(options.now().getTime());
    case "uuid":
      return options.createId();
    case "random_number":
      return (
        value.min + Math.floor(options.random() * (value.max - value.min + 1))
      );
    case "unique_email": {
      const timestamp = String(options.now().getTime());
      const uuid = options.createId();
      const unique = `${timestamp}-${uuid}`;
      return (value.template ?? "test+{{unique}}@example.test")
        .replaceAll("{{unique}}", unique)
        .replaceAll("{{timestamp}}", timestamp)
        .replaceAll("{{uuid}}", uuid);
    }
    case "current_date":
      return formatDate(options.now(), value.format);
    case "current_date_plus_days":
    case "current_date_minus_days": {
      const date = new Date(options.now());
      const direction =
        value.strategy === "current_date_plus_days" ? value.days : -value.days;
      date.setDate(date.getDate() + direction);
      return formatDate(date, value.format);
    }
    case "random_choice": {
      const index = Math.floor(options.random() * value.choices.length);
      return value.choices[index] ?? null;
    }
    case "template":
      return value.template
        .replaceAll("{{timestamp}}", String(options.now().getTime()))
        .replaceAll("{{uuid}}", options.createId());
  }
};

export const materializeDataset = (
  dataset: TestDataset | undefined,
  options: DatasetMaterializerOptions,
): Record<string, string> => {
  if (dataset === undefined) return {};
  return Object.fromEntries(
    Object.entries(dataset.values).map(([key, value]) => [
      key,
      primitiveText(materializeDatasetValue(value, options)),
    ]),
  );
};
