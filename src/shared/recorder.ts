import type { TestDefinition } from "./persistence.js";
import type {
  ActionStep,
  DatasetPrimitive,
  LocatorDefinition,
} from "./test-model.js";

export const RECORDER_STATES = [
  "idle",
  "preparing",
  "recording",
  "analyzing",
  "preview",
  "error",
  "completed",
] as const;

export type RecorderState = (typeof RECORDER_STATES)[number];
export type RecorderSignal = "green" | "yellow" | "red";

export interface RecorderStepDraft {
  step: ActionStep;
  capturedValue?: DatasetPrimitive;
  capturedInputKind?: "text" | "password" | "checkbox" | "select" | "radio";
}

export interface RecorderSnapshot {
  projectId: string;
  testId: string;
  stageId?: string;
  state: RecorderState;
  signal: RecorderSignal;
  message: string;
  test: TestDefinition;
  capturedSteps: number;
  queuedEvents: number;
  pendingStep?: RecorderStepDraft;
  error?: string;
  canStart: boolean;
  canStop: boolean;
  canRetry: boolean;
  canIgnore: boolean;
  continuationReady?: boolean;
}

export type RecorderEventType =
  | "hover"
  | "click"
  | "fill"
  | "upload_file"
  | "select"
  | "checkbox"
  | "radio"
  | "press_key"
  | "navigate"
  | "scroll";

export interface RecorderRepeatedContext {
  containerLocator: LocatorDefinition;
  distinguishingText?: string;
}

export interface RecorderFrameContext {
  origin: string;
}

export interface RecorderElementSnapshot {
  tagName: string;
  inputType?: string;
  id?: string;
  href?: string;
  name?: string;
  text?: string;
  label?: string;
  role?: string;
  actionText?: string;
  ariaLabel?: string;
  placeholder?: string;
  title?: string;
  dataAttributes: Record<string, string>;
  cssPath?: string;
  repeated?: RecorderRepeatedContext;
}

export interface RecorderRawEvent {
  type: RecorderEventType;
  url: string;
  timestamp: string;
  target?: RecorderElementSnapshot;
  hoverCandidates?: RecorderElementSnapshot[];
  value?: string;
  checked?: boolean;
  key?: string;
  scrollX?: number;
  scrollY?: number;
  scrollMode?: "dom" | "wheel";
  frameContext?: RecorderFrameContext;
}

export const isRecorderSnapshot = (
  value: unknown,
): value is RecorderSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "state" in value &&
    typeof value.state === "string" &&
    (RECORDER_STATES as readonly string[]).includes(value.state) &&
    "signal" in value &&
    (value.signal === "green" ||
      value.signal === "yellow" ||
      value.signal === "red") &&
    "projectId" in value &&
    typeof value.projectId === "string" &&
    "testId" in value &&
    typeof value.testId === "string" &&
    "message" in value &&
    typeof value.message === "string" &&
    "capturedSteps" in value &&
    typeof value.capturedSteps === "number" &&
    "queuedEvents" in value &&
    typeof value.queuedEvents === "number" &&
    "canStart" in value &&
    typeof value.canStart === "boolean" &&
    "canStop" in value &&
    typeof value.canStop === "boolean" &&
    "canRetry" in value &&
    typeof value.canRetry === "boolean" &&
    "canIgnore" in value &&
    typeof value.canIgnore === "boolean"
  );
};
