import type { MatchOperator, SimpleLocatorType } from "./test-model.js";

export type SemanticMatchOperator = MatchOperator;
export type SemanticLocatorType = SimpleLocatorType;

export interface SemanticLocatorStrategy {
  type: SemanticLocatorType;
  operator: SemanticMatchOperator;
  value: string | string[];
  role?: string;
  attribute?: string;
  caseSensitive?: boolean;
}

export interface SemanticLocatorCandidate {
  strategy: SemanticLocatorStrategy;
  unique: boolean;
  stability: number;
  reason: string;
}

export interface SemanticElementReference {
  path: string;
  fieldId: string;
  role: string;
  accessibleName: string;
  primaryLocator: SemanticLocatorCandidate;
}

export interface SemanticElementAnalysis extends SemanticElementReference {
  tag: string;
  label?: string;
  fallbackLocators: SemanticLocatorCandidate[];
  locatorStability: number;
}

export interface RepeatedComponentAnalysis {
  id: string;
  semanticName: string;
  containerSelector: SemanticLocatorCandidate;
  repeatedCount: number;
  itemPaths: string[];
  childFields: SemanticElementReference[];
  actions: SemanticElementReference[];
  titleField?: SemanticElementReference;
}

export interface CalendarCandidateAnalysis {
  id: string;
  semanticName: string;
  path: string;
  locator: SemanticLocatorCandidate;
  confidence: number;
  dayElementPaths: string[];
}

export interface SlotListAnalysis {
  id: string;
  semanticName: string;
  path: string;
  locator: SemanticLocatorCandidate;
  confidence: number;
  slotElementPaths: string[];
}

export interface SemanticAnalysis {
  schemaVersion: 1;
  generatedAt: string;
  url: string;
  elements: SemanticElementAnalysis[];
  repeatedComponents: RepeatedComponentAnalysis[];
  calendarCandidates: CalendarCandidateAnalysis[];
  slotLists: SlotListAnalysis[];
}
