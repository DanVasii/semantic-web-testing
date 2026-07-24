import type { SemanticAppApi } from "../shared/ipc.js";

declare global {
  interface Window {
    semanticApp: SemanticAppApi;
  }
}

export {};
