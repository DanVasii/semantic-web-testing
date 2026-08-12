import type {
  AiRequestPreview,
  AiRunPlanInput,
  AiRunPlanPreview,
  AiRunPlanProposal,
  AiRunPlanResult,
  AiRunStepChange,
  AiRunStepInsertion,
  AiRunStepPatch,
} from "../../shared/ai.js";
import type { JsonValue, TestDefinition } from "../../shared/persistence.js";
import {
  MATCH_OPERATORS,
  SIMPLE_LOCATOR_TYPES,
  type ActionStep,
  type SimpleLocator,
  type TestFlowItem,
} from "../../shared/test-model.js";
import type { TestsService } from "../tests-service.js";
import { validateAiRunPlanProposal } from "./ai-output.js";
import type { AiSettingsService } from "./ai-settings-service.js";
import type { PageAiContextSource } from "./ai-step-editing-service.js";

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

type JsonObject = Record<string, JsonValue>;

const asObject = (value: JsonValue | undefined): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;

const CALENDAR_SEMANTIC_MARKER =
  /\b(?:calendar|date|day|month|year|datepicker|grid|luna|anul|ziua|previous|next|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|january|february|march|april|may|june|july|august|september|october|november|december)\b|calendar[-_]|date[-_]|month[-_]|year[-_]|anterioar|următoar/i;

const buildSemanticInteractionMap = (pageAnalyses: JsonValue[]): JsonValue[] =>
  pageAnalyses
    .map((pageAnalysis) => {
      const page = asObject(pageAnalysis);
      const semantic = asObject(page?.["semanticAnalysis"]);
      const elements = Array.isArray(semantic?.["elements"])
        ? semantic["elements"]
        : [];
      const rawCalendarCandidates = Array.isArray(
        semantic?.["calendarCandidates"],
      )
        ? semantic["calendarCandidates"]
        : [];
      const calendarRuntimeHints = page?.["calendarRuntimeHints"] ?? {};
      const hintsText = JSON.stringify(calendarRuntimeHints);
      const hasRuntimeHints =
        /calendar_(?:period_marker|next_month|previous_month|date_cell_template)/.test(
          hintsText,
        );
      const calendarCandidates = rawCalendarCandidates
        .slice(0, 8)
        .map((candidate) => {
          const object = asObject(candidate);
          return {
            semanticName: object?.["semanticName"] ?? "",
            locator: object?.["locator"] ?? {},
          };
        });
      const controlsAndMarkers = elements
        .filter((element) =>
          CALENDAR_SEMANTIC_MARKER.test(JSON.stringify(element)),
        )
        .slice(0, 16)
        .map((element) => {
          const object = asObject(element);
          return {
            fieldId: object?.["fieldId"] ?? "",
            role: object?.["role"] ?? "",
            accessibleName: object?.["accessibleName"] ?? "",
            primaryLocator: object?.["primaryLocator"] ?? {},
          };
        });
      return {
        priority:
          (hasRuntimeHints ? 2 : 0) +
          (rawCalendarCandidates.length > 0 ? 1 : 0),
        value: asJson({
          pageId: page?.["pageId"] ?? "",
          title: page?.["title"] ?? "",
          normalizedUrl: page?.["normalizedUrl"] ?? "",
          calendarRuntimeHints,
          calendarCandidates,
          controlsAndMarkers,
        }),
      };
    })
    .sort((left, right) => right.priority - left.priority)
    .map(({ value }) => value);

const constrainRunPlanStepIds = (
  request: AiRequestPreview,
  stepIds: string[],
): AiRequestPreview => {
  const outputSchema = structuredClone(request.outputSchema);
  const root = asObject(outputSchema);
  const properties = asObject(root?.["properties"]);
  const changes = asObject(properties?.["changes"]);
  const changeItems = asObject(changes?.["items"]);
  const changeProperties = asObject(changeItems?.["properties"]);
  const insertions = asObject(properties?.["insertions"]);
  const insertionItems = asObject(insertions?.["items"]);
  const insertionProperties = asObject(insertionItems?.["properties"]);
  if (changeProperties !== undefined) {
    changeProperties["stepId"] = {
      type: "string",
      enum: [...stepIds],
    };
  }
  if (insertionProperties !== undefined) {
    insertionProperties["anchorStepId"] = {
      type: "string",
      enum: [...stepIds],
    };
  }
  const previousSchemaLength = JSON.stringify(request.outputSchema).length;
  const nextSchemaLength = JSON.stringify(outputSchema).length;
  return {
    ...request,
    outputSchema,
    estimatedInputTokens:
      request.estimatedInputTokens +
      Math.max(0, Math.ceil((nextSchemaLength - previousSchemaLength) / 4)),
  };
};

const MONTHS: Readonly<Record<string, number>> = {
  ianuarie: 1,
  january: 1,
  februarie: 2,
  february: 2,
  martie: 3,
  march: 3,
  aprilie: 4,
  april: 4,
  mai: 5,
  may: 5,
  iunie: 6,
  june: 6,
  iulie: 7,
  july: 7,
  august: 8,
  septembrie: 9,
  september: 9,
  octombrie: 10,
  october: 10,
  noiembrie: 11,
  november: 11,
  decembrie: 12,
  december: 12,
};

const ROMANIAN_MONTHS = [
  "",
  "ianuarie",
  "februarie",
  "martie",
  "aprilie",
  "mai",
  "iunie",
  "iulie",
  "august",
  "septembrie",
  "octombrie",
  "noiembrie",
  "decembrie",
] as const;

const ENGLISH_MONTHS = [
  "",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

interface CalendarPeriod {
  year: number;
  month: number;
}

interface CalendarDateRequest {
  day?: number;
  month: number;
  year?: number;
}

type AiSimpleLocator = NonNullable<AiRunStepPatch["primaryLocator"]>;

const normalizedText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const parseMonth = (value: string): number | undefined =>
  Object.entries(MONTHS).find(([name]) =>
    normalizedText(value).includes(normalizedText(name)),
  )?.[1];

const parseCalendarRequest = (
  instruction: string,
): CalendarDateRequest | undefined => {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(instruction);
  if (iso !== null) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }
  const month = parseMonth(instruction);
  if (month === undefined) return undefined;
  const normalized = normalizedText(instruction);
  const monthNames = Object.keys(MONTHS).map(normalizedText).join("|");
  const natural = new RegExp(
    `\\b(\\d{1,2})?\\s*(?:${monthNames})\\s*(20\\d{2})?\\b`,
    "i",
  ).exec(normalized);
  if (natural === null) return undefined;
  const day =
    natural?.[1] === undefined || natural[1].length === 0
      ? undefined
      : Number(natural[1]);
  const year =
    natural?.[2] === undefined || natural[2].length === 0
      ? undefined
      : Number(natural[2]);
  if (day !== undefined && (day < 1 || day > 31)) return undefined;
  return {
    month,
    ...(day === undefined ? {} : { day }),
    ...(year === undefined ? {} : { year }),
  };
};

const collectObjects = (value: JsonValue): JsonObject[] => {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  const object = asObject(value);
  if (object === undefined) return [];
  return [
    object,
    ...Object.values(object).flatMap((nested) => collectObjects(nested)),
  ];
};

const simpleLocatorFrom = (
  value: JsonValue | undefined,
): AiSimpleLocator | undefined => {
  const object = asObject(value);
  if (object === undefined) return undefined;
  const type = object["type"];
  const operator = object["operator"];
  const locatorValue = object["value"];
  if (
    typeof type !== "string" ||
    !(SIMPLE_LOCATOR_TYPES as readonly string[]).includes(type) ||
    typeof operator !== "string" ||
    !(MATCH_OPERATORS as readonly string[]).includes(operator) ||
    typeof locatorValue !== "string"
  ) {
    return undefined;
  }
  return {
    type: type as SimpleLocator["type"],
    operator: operator as SimpleLocator["operator"],
    value: locatorValue,
    ...(typeof object["role"] === "string" ? { role: object["role"] } : {}),
    ...(typeof object["attribute"] === "string"
      ? { attribute: object["attribute"] }
      : {}),
  };
};

const semanticLocatorFrom = (
  object: JsonObject,
): AiSimpleLocator | undefined => {
  const direct = simpleLocatorFrom(object);
  if (direct !== undefined) return direct;
  for (const key of ["primaryLocator", "locator"]) {
    const wrapper = asObject(object[key]);
    const locator =
      simpleLocatorFrom(wrapper?.["strategy"]) ?? simpleLocatorFrom(wrapper);
    if (locator !== undefined) return locator;
  }
  return undefined;
};

const parsePeriod = (value: string): CalendarPeriod | undefined => {
  const month = parseMonth(value);
  const year = /\b(20\d{2})\b/.exec(value);
  return month === undefined || year?.[1] === undefined
    ? undefined
    : { month, year: Number(year[1]) };
};

const findSemanticObject = (
  objects: JsonObject[],
  predicate: (text: string, object: JsonObject) => boolean,
): JsonObject | undefined =>
  objects.find((object) =>
    predicate(normalizedText(JSON.stringify(object)), object),
  );

const actionText = (action: ActionStep): string =>
  normalizedText(JSON.stringify(action));

const actionSimpleLocator = (
  action: ActionStep | undefined,
): AiSimpleLocator | undefined => {
  const primary = action?.target?.primary;
  if (
    primary === undefined ||
    primary.type === "relative" ||
    primary.type === "repeated_component" ||
    typeof primary.value !== "string"
  ) {
    return undefined;
  }
  return structuredClone(primary) as AiSimpleLocator;
};

const dateFromText = (
  value: string,
): { year: number; month: number; day: number } | undefined => {
  const match = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(value);
  return match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
    ? undefined
    : {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
};

const withTargetDate = (
  locator: AiSimpleLocator,
  year: number,
  month: number,
  day: number,
): AiSimpleLocator | undefined => {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
  if (/\b20\d{2}-\d{2}-\d{2}\b/.test(locator.value)) {
    return {
      ...locator,
      value: locator.value.replace(/\b20\d{2}-\d{2}-\d{2}\b/, iso),
    };
  }
  if (
    locator.type === "data_attribute" &&
    /calendar-day|date-cell|booking-date/i.test(locator.value)
  ) {
    return { ...locator, value: `calendar-day-${iso}` };
  }
  return undefined;
};

const mergeChanges = (
  aiChanges: AiRunStepChange[],
  calendarChanges: AiRunStepChange[],
): AiRunStepChange[] => {
  const merged = new Map(
    aiChanges.map((change) => [change.stepId, structuredClone(change)]),
  );
  for (const change of calendarChanges) {
    const existing = merged.get(change.stepId);
    const patch = {
      ...(existing?.patch ?? {}),
      ...change.patch,
    };
    if (change.patch.repeatUntil !== undefined) delete patch.repeat;
    if (change.patch.repeat !== undefined) delete patch.repeatUntil;
    merged.set(
      change.stepId,
      existing === undefined
        ? change
        : {
            stepId: change.stepId,
            patch,
            rationale: `${existing.rationale} ${change.rationale}`.trim(),
          },
    );
  }
  return [...merged.values()];
};

const hasConditionalNavigation = (proposal: AiRunPlanProposal): boolean =>
  proposal.changes.some((change) => change.patch.repeatUntil !== undefined) ||
  proposal.insertions.some(
    (insertion) => insertion.action.repeatUntil !== undefined,
  );

const missesCalendarChanges = (
  proposal: AiRunPlanProposal,
  calendarPlan: AiRunPlanProposal,
  test: TestDefinition,
): boolean => {
  const missesChange = calendarPlan.changes.some((calendarChange) => {
    const proposed = proposal.changes.find(
      (change) => change.stepId === calendarChange.stepId,
    );
    if (proposed === undefined) return true;
    if (
      calendarChange.patch.primaryLocator !== undefined &&
      (proposed.patch.primaryLocator?.value ??
        actionSimpleLocator(
          test.flowItems.find(
            (item): item is ActionStep =>
              item.id === calendarChange.stepId && item.type === "action",
          ),
        )?.value) !== calendarChange.patch.primaryLocator.value
    ) {
      return true;
    }
    if (
      calendarChange.patch.datasetValue !== undefined &&
      proposed.patch.datasetValue !== calendarChange.patch.datasetValue
    ) {
      return true;
    }
    if (
      calendarChange.patch.repeatUntil !== undefined &&
      proposed.patch.repeatUntil === undefined
    ) {
      return true;
    }
    return false;
  });
  if (missesChange) return true;
  return calendarPlan.insertions.some((calendarInsertion) => {
    const expectedLocator = calendarInsertion.action.primaryLocator;
    return !proposal.insertions.some(
      (insertion) =>
        insertion.action.actionType === calendarInsertion.action.actionType &&
        insertion.action.primaryLocator.type === expectedLocator.type &&
        insertion.action.primaryLocator.attribute ===
          expectedLocator.attribute &&
        insertion.action.primaryLocator.value === expectedLocator.value &&
        (calendarInsertion.action.repeatUntil === undefined ||
          insertion.action.repeatUntil !== undefined),
    );
  });
};

const buildCalendarPlan = (
  instruction: string,
  test: TestDefinition,
  context: JsonValue,
  anchorStepId?: string,
): AiRunPlanProposal | undefined => {
  const requested = parseCalendarRequest(instruction);
  if (requested === undefined) return undefined;
  const actions = test.flowItems.filter(
    (item): item is ActionStep => item.type === "action",
  );
  const dayStep = actions.find((action) =>
    /calendar-day|date-cell|booking-date|alege.*zi|select.*day/.test(
      actionText(action),
    ),
  );
  const recordedDate = dateFromText(JSON.stringify(dayStep ?? {}));
  const objects = collectObjects(context);
  const initialMarker =
    findSemanticObject(objects, (_text, object) => {
      const markerText =
        typeof object["text"] === "string"
          ? object["text"]
          : typeof object["accessibleName"] === "string"
            ? object["accessibleName"]
            : "";
      return (
        object["kind"] === "calendar_period_marker" &&
        parsePeriod(markerText) !== undefined
      );
    }) ??
    findSemanticObject(objects, (_text, object) => {
      const role = object["role"];
      const fieldId = object["fieldId"];
      const accessibleName =
        typeof object["accessibleName"] === "string"
          ? object["accessibleName"]
          : typeof object["text"] === "string"
            ? object["text"]
            : undefined;
      return (
        (role === "heading" ||
          (typeof fieldId === "string" &&
            /heading|period|month/i.test(fieldId))) &&
        typeof accessibleName === "string" &&
        parsePeriod(accessibleName) !== undefined
      );
    });
  const initialMarkerText =
    typeof initialMarker?.["accessibleName"] === "string"
      ? initialMarker["accessibleName"]
      : typeof initialMarker?.["text"] === "string"
        ? initialMarker["text"]
        : "";
  const initialPeriod =
    initialMarkerText.length > 0 ? parsePeriod(initialMarkerText) : undefined;
  const initialPeriodText = normalizedText(initialMarkerText);
  const semanticText = normalizedText(JSON.stringify(context));
  const explicitlyRomanian =
    /luna urmatoare|luna anterioara|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|septembrie|octombrie|noiembrie|decembrie/.test(
      semanticText,
    );
  const usesEnglishMonthNames =
    !explicitlyRomanian &&
    ENGLISH_MONTHS.slice(1).some((monthName) =>
      new RegExp(`\\b${monthName}\\b`).test(initialPeriodText),
    );
  const targetYear =
    requested.year ?? recordedDate?.year ?? initialPeriod?.year;
  const targetDay = requested.day ?? recordedDate?.day;
  if (targetYear === undefined) return undefined;

  const markerObject =
    initialMarker ??
    findSemanticObject(objects, (text) =>
      /calendar.heading|month.heading|visible.period/.test(text),
    );
  const markerLocator =
    markerObject === undefined ? undefined : semanticLocatorFrom(markerObject);
  const nextObject = findSemanticObject(
    objects,
    (text, object) =>
      semanticLocatorFrom(object) !== undefined &&
      (object["kind"] === "calendar_next_month" ||
        /calendar-next|next.month|luna urmatoare|urmatoarea luna/.test(text)),
  );
  const previousObject = findSemanticObject(
    objects,
    (text, object) =>
      semanticLocatorFrom(object) !== undefined &&
      (object["kind"] === "calendar_previous_month" ||
        /calendar-previous|previous.month|luna anterioara|anterioara luna/.test(
          text,
        )),
  );
  const semanticNext =
    nextObject === undefined ? undefined : semanticLocatorFrom(nextObject);
  const semanticPrevious =
    previousObject === undefined
      ? undefined
      : semanticLocatorFrom(previousObject);
  const dateCellTemplate = findSemanticObject(
    objects,
    (_text, object) => object["kind"] === "calendar_date_cell_template",
  );
  const dateCellLocator =
    dateCellTemplate === undefined
      ? undefined
      : semanticLocatorFrom(dateCellTemplate);

  const yearStep = actions.find(
    (action) =>
      action.actionType === "select_option" &&
      /calendar.year|year|anul/.test(actionText(action)),
  );
  const nextSteps = actions.filter(
    (action) =>
      ["click", "calendar_select"].includes(action.actionType) &&
      /calendar-next|next.month|luna urmatoare|urmatoarea luna/.test(
        actionText(action),
      ),
  );
  const previousSteps = actions.filter(
    (action) =>
      ["click", "calendar_select"].includes(action.actionType) &&
      /calendar-previous|previous.month|luna anterioara|anterioara luna/.test(
        actionText(action),
      ),
  );
  const changes: AiRunStepChange[] = [];
  const insertions: AiRunStepInsertion[] = [];
  const hintedAnchor = test.flowItems.find(
    (item): item is ActionStep =>
      item.id === anchorStepId && item.type === "action",
  );
  const fallbackAnchor = [...actions]
    .reverse()
    .find((action) => action.actionType === "scroll");
  const insertionAnchor = dayStep ?? hintedAnchor ?? fallbackAnchor;
  const insertionPosition = dayStep === undefined ? "after" : "before";

  if (yearStep !== undefined) {
    changes.push({
      stepId: yearStep.id,
      patch: { datasetValue: String(targetYear) },
      rationale:
        "Anul este stabilit explicit pentru starea inițială a rulării.",
    });
  }

  if (dayStep !== undefined && targetDay !== undefined) {
    const locator = actionSimpleLocator(dayStep);
    const targetLocator =
      locator === undefined
        ? undefined
        : withTargetDate(locator, targetYear, requested.month, targetDay);
    if (targetLocator !== undefined) {
      changes.push({
        stepId: dayStep.id,
        patch: { primaryLocator: targetLocator },
        rationale: "Ziua folosește data cerută pentru această rulare.",
      });
    }
  }
  const insertedDayLocator =
    dayStep === undefined &&
    targetDay !== undefined &&
    dateCellLocator !== undefined
      ? withTargetDate(dateCellLocator, targetYear, requested.month, targetDay)
      : undefined;

  let direction: "next" | "previous" | "none" | undefined;
  if (initialPeriod !== undefined) {
    const initialIndex =
      yearStep === undefined
        ? initialPeriod.year * 12 + initialPeriod.month
        : initialPeriod.month;
    const targetIndex =
      yearStep === undefined
        ? targetYear * 12 + requested.month
        : requested.month;
    direction =
      targetIndex === initialIndex
        ? "none"
        : targetIndex > initialIndex
          ? "next"
          : "previous";
  } else if (nextSteps.length > 0) {
    direction = "next";
  } else if (previousSteps.length > 0) {
    direction = "previous";
  }

  const allNavigationSteps = [...nextSteps, ...previousSteps];
  if (direction === "none") {
    for (const action of allNavigationSteps) {
      changes.push({
        stepId: action.id,
        patch: { repeat: 0 },
        rationale:
          "Perioada cerută este deja vizibilă în starea inițială a rulării.",
      });
    }
  } else if (direction !== undefined && markerLocator !== undefined) {
    const desiredSteps = direction === "next" ? nextSteps : previousSteps;
    const oppositeSteps = direction === "next" ? previousSteps : nextSteps;
    const semanticControl =
      direction === "next" ? semanticNext : semanticPrevious;
    const reusable = desiredSteps[0] ?? oppositeSteps[0];
    const repeatUntil = {
      target: markerLocator,
      operator: "contains" as const,
      value: `${
        usesEnglishMonthNames
          ? ENGLISH_MONTHS[requested.month]
          : ROMANIAN_MONTHS[requested.month]
      } ${targetYear}`,
      maxAttempts: 24,
    };
    if (reusable !== undefined) {
      const desiredLocator =
        desiredSteps.length > 0
          ? actionSimpleLocator(reusable)
          : semanticControl;
      changes.push({
        stepId: reusable.id,
        patch: {
          ...(desiredLocator === undefined
            ? {}
            : { primaryLocator: desiredLocator }),
          repeatUntil,
        },
        rationale:
          "Navigarea verifică markerul vizual de la starea inițială până la perioada țintă.",
      });
      for (const extra of allNavigationSteps.filter(
        (action) => action.id !== reusable.id,
      )) {
        changes.push({
          stepId: extra.id,
          patch: { repeat: 0 },
          rationale: "Pas de navigare redundant pentru planul condiționat.",
        });
      }
    } else if (semanticControl !== undefined && insertionAnchor !== undefined) {
      insertions.push({
        anchorStepId: insertionAnchor.id,
        position: insertionPosition,
        action: {
          actionType: "click",
          title:
            direction === "next"
              ? "Navighează la luna următoare"
              : "Navighează la luna anterioară",
          humanDescription:
            "Navighează până când markerul vizual arată perioada cerută.",
          whyExplanation:
            "Pas temporar dedus din analiza semantică și verificat la runtime.",
          primaryLocator: semanticControl,
          repeatUntil,
        },
        rationale: "Înregistrarea nu conține controlul de navigare necesar.",
      });
    }
  }

  if (insertedDayLocator !== undefined && insertionAnchor !== undefined) {
    insertions.push({
      anchorStepId: insertionAnchor.id,
      position: insertionPosition,
      action: {
        actionType: "click",
        title: `Selectează ziua ${targetDay}`,
        humanDescription: `Selectează data ${String(targetDay).padStart(2, "0")}.${String(requested.month).padStart(2, "0")}.${targetYear}.`,
        whyExplanation:
          "Pas temporar construit din atributul de dată capturat în analiza paginii.",
        primaryLocator: insertedDayLocator,
      },
      rationale:
        "Înregistrarea nu conține selecția zilei, iar locatorul este derivat din șablonul data-date al calendarului.",
    });
  }

  if (changes.length === 0 && insertions.length === 0) return undefined;
  return {
    summary:
      "Planul calendarului a fost completat logic din instrucțiune și analiza semantică.",
    changes,
    insertions,
  };
};

interface ReconciledAiPlan {
  proposal: AiRunPlanProposal;
  discardedStepIds: string[];
  reanchoredStepIds: string[];
}

const reconcileAiPlan = (
  proposal: AiRunPlanProposal,
  test: TestDefinition,
  calendarPlan: AiRunPlanProposal | undefined,
): ReconciledAiPlan => {
  const knownIds = new Set(test.flowItems.map((item) => item.id));
  const discardedStepIds = proposal.changes
    .filter((change) => !knownIds.has(change.stepId))
    .map((change) => change.stepId);
  const changes = proposal.changes.flatMap((change): AiRunStepChange[] => {
    if (!knownIds.has(change.stepId)) return [];
    const item = test.flowItems.find(
      (candidate) => candidate.id === change.stepId,
    );
    if (item?.type !== "action") {
      discardedStepIds.push(change.stepId);
      return [];
    }
    const patch = structuredClone(change.patch);
    const repeatable = [
      "click",
      "choose_repeated_item",
      "calendar_select",
    ].includes(item.actionType);
    if (!repeatable) {
      delete patch.repeat;
      delete patch.repeatUntil;
    }
    if (item.target === undefined) delete patch.primaryLocator;
    if (item.valueKey === undefined) delete patch.datasetValue;
    if (Object.keys(patch).length === 0) {
      discardedStepIds.push(change.stepId);
      return [];
    }
    return [{ ...change, patch }];
  });
  const localDayInsertion = calendarPlan?.insertions.find(
    (insertion) =>
      insertion.action.repeatUntil === undefined &&
      dateFromText(insertion.action.primaryLocator.value) !== undefined,
  );
  const localNavigationInsertion = calendarPlan?.insertions.find(
    (insertion) => insertion.action.repeatUntil !== undefined,
  );
  const calendarDayStepId =
    calendarPlan?.changes.find((change) => {
      const value = change.patch.primaryLocator?.value;
      return typeof value === "string" && /calendar-day|date-cell/i.test(value);
    })?.stepId ??
    test.flowItems.find(
      (item) =>
        item.type === "action" &&
        /calendar-day|date-cell/i.test(actionText(item)),
    )?.id;
  const calendarYearAlreadyPatched =
    calendarPlan?.changes.some((change) => {
      const item = test.flowItems.find(
        (candidate) => candidate.id === change.stepId,
      );
      return (
        item?.type === "action" &&
        item.actionType === "select_option" &&
        change.patch.datasetValue !== undefined &&
        /calendar.year|year|anul/.test(actionText(item))
      );
    }) === true;
  const reanchoredStepIds: string[] = [];
  const insertions = proposal.insertions.flatMap(
    (insertion): AiRunStepInsertion[] => {
      const insertionText = normalizedText(JSON.stringify(insertion.action));
      const insertionDate = dateFromText(insertionText);
      const isCalendarAction =
        calendarPlan !== undefined &&
        /calendar|month|year|date|day|luna|anul|ziua/.test(insertionText);
      const isRedundantCalendarDay =
        (localDayInsertion !== undefined ||
          (calendarDayStepId !== undefined &&
            insertion.action.actionType === "calendar_select")) &&
        (insertionDate !== undefined ||
          /calendar|date|day|ziua/.test(insertionText));
      if (isRedundantCalendarDay) {
        discardedStepIds.push(insertion.anchorStepId);
        return [];
      }
      if (
        localNavigationInsertion !== undefined &&
        insertion.action.repeatUntil !== undefined
      ) {
        discardedStepIds.push(insertion.anchorStepId);
        return [];
      }
      if (
        calendarYearAlreadyPatched &&
        insertion.action.actionType === "select_option" &&
        /calendar.year|year|anul/.test(insertionText)
      ) {
        discardedStepIds.push(insertion.anchorStepId);
        return [];
      }
      if (knownIds.has(insertion.anchorStepId)) return [insertion];
      if (!isCalendarAction || calendarDayStepId === undefined) {
        discardedStepIds.push(insertion.anchorStepId);
        return [];
      }
      reanchoredStepIds.push(insertion.anchorStepId);
      return [{ ...insertion, anchorStepId: calendarDayStepId }];
    },
  );
  return {
    proposal: {
      summary: proposal.summary,
      changes,
      insertions,
    },
    discardedStepIds: [...new Set(discardedStepIds)],
    reanchoredStepIds: [...new Set(reanchoredStepIds)],
  };
};

const validateInput = (input: AiRunPlanInput): void => {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.projectId !== "string" ||
    input.projectId.length === 0 ||
    typeof input.testId !== "string" ||
    input.testId.length === 0 ||
    typeof input.instruction !== "string" ||
    input.instruction.trim().length === 0 ||
    input.instruction.length > 2_000 ||
    (input.model !== undefined &&
      (input.model.length === 0 ||
        input.model.length > 200 ||
        /[\r\n]/.test(input.model)))
  ) {
    throw new Error("Instrucțiunea AI pentru rulare nu este validă.");
  }
};

const pageIdsFrom = (items: TestFlowItem[]): string[] =>
  [
    ...new Set(
      items.flatMap((item) =>
        item.type === "action" && item.pageId !== undefined
          ? [item.pageId]
          : [],
      ),
    ),
  ].slice(0, 10);

const requireAction = (test: TestDefinition, stepId: string): ActionStep => {
  const item = test.flowItems.find((candidate) => candidate.id === stepId);
  if (item?.type !== "action") {
    throw new Error(`Planul AI indică pasul de acțiune inexistent ${stepId}.`);
  }
  return item;
};

export interface AppliedAiRunPlan {
  test: TestDefinition;
  datasetOverrides: Record<string, string>;
}

export const applyAiRunPlan = (
  source: TestDefinition,
  rawProposal: AiRunPlanProposal,
): AppliedAiRunPlan => {
  const proposal = validateAiRunPlanProposal(rawProposal);
  if (proposal.changes.length === 0 && proposal.insertions.length === 0) {
    throw new Error("Planul AI nu conține nicio schimbare sau inserare.");
  }
  const changes = new Map(
    proposal.changes.map((change) => [change.stepId, change]),
  );
  const knownIds = new Set(source.flowItems.map((item) => item.id));
  if (proposal.changes.some((change) => !knownIds.has(change.stepId))) {
    throw new Error("Planul AI conține un pas care nu există în test.");
  }
  if (
    proposal.insertions.some(
      (insertion) => !knownIds.has(insertion.anchorStepId),
    )
  ) {
    throw new Error("Planul AI inserează un pas lângă o ancoră inexistentă.");
  }
  const datasetOverrides: Record<string, string> = {};
  for (const change of proposal.changes) {
    const action = requireAction(source, change.stepId);
    if (
      change.patch.primaryLocator !== undefined &&
      action.target === undefined
    ) {
      throw new Error(`Pasul ${action.id} nu acceptă un locator temporar.`);
    }
    if (
      change.patch.repeat !== undefined &&
      !["click", "choose_repeated_item", "calendar_select"].includes(
        action.actionType,
      )
    ) {
      throw new Error(`Pasul ${action.id} nu poate fi repetat.`);
    }
    if (
      change.patch.repeatUntil !== undefined &&
      !["click", "choose_repeated_item", "calendar_select"].includes(
        action.actionType,
      )
    ) {
      throw new Error(`Pasul ${action.id} nu poate fi repetat condiționat.`);
    }
    if (change.patch.datasetValue !== undefined) {
      if (action.valueKey === undefined) {
        throw new Error(
          `Pasul ${action.id} nu are o valoare de dataset suprascriptibilă.`,
        );
      }
      datasetOverrides[action.valueKey] = change.patch.datasetValue;
    }
  }
  const changedFlowItems = source.flowItems.map((item): TestFlowItem => {
    const change = changes.get(item.id);
    if (change === undefined || item.type !== "action") return item;
    const action = structuredClone(item);
    if (
      change.patch.primaryLocator !== undefined &&
      action.target !== undefined
    ) {
      action.target.primary = structuredClone(change.patch.primaryLocator);
    }
    if (change.patch.repeat !== undefined) {
      action.repeat = change.patch.repeat;
      delete action.repeatUntil;
    }
    if (change.patch.repeatUntil !== undefined) {
      action.repeatUntil = structuredClone(change.patch.repeatUntil);
      delete action.repeat;
    }
    return action;
  });
  const reservedIds = new Set(knownIds);
  const insertedByAnchor = new Map<
    string,
    { before: ActionStep[]; after: ActionStep[] }
  >();
  proposal.insertions.forEach((insertion, index) => {
    if (
      insertion.action.datasetValue !== undefined &&
      insertion.action.actionType !== "select_option"
    ) {
      throw new Error(
        `Pasul inserat ${insertion.action.title} folosește datasetValue cu o acțiune incompatibilă.`,
      );
    }
    let id = `ai-run-insert-${index + 1}`;
    let suffix = 1;
    while (reservedIds.has(id)) {
      suffix += 1;
      id = `ai-run-insert-${index + 1}-${suffix}`;
    }
    reservedIds.add(id);
    const anchor = source.flowItems.find(
      (item) => item.id === insertion.anchorStepId,
    );
    const datasetKey = `ai_run_insert_${index + 1}_value`;
    const action: ActionStep = {
      id,
      type: "action",
      actionType: insertion.action.actionType,
      title: insertion.action.title,
      humanDescription: insertion.action.humanDescription,
      whyExplanation: insertion.action.whyExplanation,
      ...(anchor?.type === "action" && anchor.pageId !== undefined
        ? { pageId: anchor.pageId }
        : {}),
      target: {
        primary: structuredClone(insertion.action.primaryLocator),
      },
      ...(insertion.action.datasetValue === undefined
        ? {}
        : {
            inputFieldId: datasetKey,
            valueKey: datasetKey,
            valueStrategy: "dataset" as const,
          }),
      ...(insertion.action.repeat === undefined
        ? {}
        : { repeat: insertion.action.repeat }),
      ...(insertion.action.repeatUntil === undefined
        ? {}
        : { repeatUntil: structuredClone(insertion.action.repeatUntil) }),
      fallbacks: [],
      enabled: true,
    };
    if (insertion.action.datasetValue !== undefined) {
      datasetOverrides[datasetKey] = insertion.action.datasetValue;
    }
    const bucket = insertedByAnchor.get(insertion.anchorStepId) ?? {
      before: [],
      after: [],
    };
    bucket[insertion.position].push(action);
    insertedByAnchor.set(insertion.anchorStepId, bucket);
  });
  const flowItems = changedFlowItems.flatMap((item): TestFlowItem[] => {
    const inserted = insertedByAnchor.get(item.id);
    return [...(inserted?.before ?? []), item, ...(inserted?.after ?? [])];
  });
  return {
    test: {
      ...source,
      flowItems,
    },
    datasetOverrides,
  };
};

export class AiRunPlanningService {
  public constructor(
    private readonly aiSettings: AiSettingsService,
    private readonly tests: TestsService,
    private readonly pageContext: PageAiContextSource,
  ) {}

  public async preview(input: AiRunPlanInput): Promise<AiRunPlanPreview> {
    validateInput(input);
    const test = this.tests.get(input.projectId, input.testId);
    if (test.testMode !== "dynamic_ai") {
      throw new Error(
        "Instrucțiunile AI la rulare sunt disponibile numai pentru testele dinamice.",
      );
    }
    const pageIds = pageIdsFrom(test.flowItems);
    const pageAnalyses = await this.pageContext.getAiSemanticContext(
      input.projectId,
      pageIds,
    );
    const semanticInteractionMap = buildSemanticInteractionMap(pageAnalyses);
    const context = asJson({
      userInstruction: input.instruction.trim(),
      runtimeRules: {
        requiredOutcome:
          "Instrucțiunea cere o adaptare: changes și insertions nu pot fi ambele goale.",
        recordingStateIsNotRuntimeState:
          "Starea vizibilă după înregistrare este doar rezultatul acțiunilor înregistrate. Rularea reîncepe de la starea inițială a paginii.",
        visualLoop:
          "Pentru navigare calendaristică nu deduce repeat din ultima lună observată. Folosește repeatUntil cu locatorul markerului vizual de lună/an, valoarea țintă și maxAttempts. Runnerul verifică markerul înainte și după fiecare click.",
        direction:
          "Alege controlul Next sau Previous din semanticInteractionMap în funcție de perioada țintă. Dacă există un select de an, adaptează sau inserează select_option înaintea buclei lunii.",
        insertions:
          "Dacă flow-ul nu conține acțiunea necesară, adaug-o temporar în insertions înainte/după un anchorStepId existent. Nu inventa locatori: folosește locatorii din flow sau semanticInteractionMap.",
      },
      semanticInteractionMap,
      test: {
        id: test.id,
        name: test.name,
        description: test.description ?? "",
        startUrl: test.startUrl,
        version: test.version,
        testMode: test.testMode,
      },
      recordedFlow: test.flowItems,
      constraints: {
        exactStepIds: test.flowItems.map((item) => item.id),
        allowedTemporaryPatches: {
          primaryLocator: "Înlocuiește locatorul numai pentru această rulare.",
          repeat:
            "Număr fix de execuții; folosește-l numai când numărul este independent de starea paginii.",
          repeatUntil:
            "Repetă click-ul până când textul sau valoarea markerului vizual corespunde țintei, maximum maxAttempts.",
          datasetValue:
            "Suprascrie temporar valoarea identificată de valueKey.",
        },
        allowedTemporaryInsertions: [
          "click",
          "calendar_select",
          "select_option",
          "wait_for_element",
        ],
        calendarGuidance:
          "Pentru altă lună/an: aplică repeatUntil numai unui click real Next/Previous din calendarRuntimeHints, apoi folosește șablonul real al zilei (inclusiv data-date). Nu aplica repeatUntil pe scroll/input și nu inventa convenții de ID. Poți insera pașii lipsă. Nu presupune că rularea începe din starea finală a înregistrării.",
      },
    });
    const stepIds = test.flowItems.map((item) => item.id);
    const request = constrainRunPlanStepIds(
      this.aiSettings.preview({
        task: "adapt_run",
        context,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
      }),
      stepIds,
    );
    return {
      request,
      stepIds,
      pageIds,
    };
  }

  public async generate(input: AiRunPlanInput): Promise<AiRunPlanResult> {
    const preview = await this.preview(input);
    const generation = await this.aiSettings.generate({
      task: "adapt_run",
      context: preview.request.contextPreview,
      provider: preview.request.provider,
      model: preview.request.model,
      outputSchema: preview.request.outputSchema,
    });
    const test = this.tests.get(input.projectId, input.testId);
    const rawAiProposal = validateAiRunPlanProposal(generation.output);
    console.info(
      `[AI][adapt_run] obiect validat:\n${JSON.stringify(rawAiProposal, null, 2).slice(0, 50_000)}`,
    );
    const calendarAnchorHint =
      rawAiProposal.insertions.find((insertion) =>
        /calendar|date|day|month|luna|ziua/.test(
          normalizedText(JSON.stringify(insertion.action)),
        ),
      )?.anchorStepId ??
      rawAiProposal.changes.find(
        (change) => change.patch.repeatUntil !== undefined,
      )?.stepId;
    const calendarPlan = buildCalendarPlan(
      input.instruction,
      test,
      preview.request.contextPreview,
      calendarAnchorHint,
    );
    const reconciliation = reconcileAiPlan(rawAiProposal, test, calendarPlan);
    const aiProposal = reconciliation.proposal;
    if (
      reconciliation.discardedStepIds.length > 0 ||
      reconciliation.reanchoredStepIds.length > 0
    ) {
      console.info(
        `[AI][adapt_run] reconciliere ID-uri:\n${JSON.stringify(
          {
            discardedStepIds: reconciliation.discardedStepIds,
            reanchoredStepIds: reconciliation.reanchoredStepIds,
            realStepIds: test.flowItems.map((item) => item.id),
          },
          null,
          2,
        )}`,
      );
    }
    const aiPlanIsEmpty =
      aiProposal.changes.length === 0 && aiProposal.insertions.length === 0;
    const shouldCompleteCalendarPlan =
      calendarPlan !== undefined &&
      (aiPlanIsEmpty ||
        missesCalendarChanges(aiProposal, calendarPlan, test) ||
        (hasConditionalNavigation(calendarPlan) &&
          !hasConditionalNavigation(aiProposal)));
    let completedProposal = aiProposal;
    if (shouldCompleteCalendarPlan && calendarPlan !== undefined) {
      completedProposal = {
        summary: aiPlanIsEmpty
          ? calendarPlan.summary
          : `${aiProposal.summary} ${calendarPlan.summary}`,
        changes: mergeChanges(aiProposal.changes, calendarPlan.changes),
        insertions: [...aiProposal.insertions, ...calendarPlan.insertions],
      };
    }
    const proposal = validateAiRunPlanProposal(completedProposal);
    console.info(
      `[AI][adapt_run] plan final:\n${JSON.stringify(proposal, null, 2).slice(0, 50_000)}`,
    );
    applyAiRunPlan(test, proposal);
    return {
      provider: generation.provider,
      model: generation.model,
      proposal,
      usage: generation.usage,
    };
  }
}
