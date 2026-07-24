export const RENDERER_DEVELOPMENT_URL = "http://127.0.0.1:5173";

export type RendererTarget =
  | {
      kind: "development-url";
      value: typeof RENDERER_DEVELOPMENT_URL;
    }
  | {
      kind: "production-file";
      value: string;
    };

export const resolveRendererTarget = (
  developmentUrl: string | undefined,
  rendererEntryPath: string,
): RendererTarget => {
  if (developmentUrl === undefined) {
    return {
      kind: "production-file",
      value: rendererEntryPath,
    };
  }

  if (developmentUrl !== RENDERER_DEVELOPMENT_URL) {
    throw new Error("Adresa renderer-ului de development nu este permisă.");
  }

  return {
    kind: "development-url",
    value: RENDERER_DEVELOPMENT_URL,
  };
};
