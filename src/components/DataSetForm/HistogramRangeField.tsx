import { lazy, Suspense, useMemo, useRef } from "react";
import type { Data } from "plotly.js";

import { t } from "../../i18n/translate";
import type { JsonSchema } from "../../runtime/runtime";
import { nextFiniteFloat64 } from "../../utils/float64";
import { numericValueValid } from "./rangeValidation";

type Values = Record<string, unknown>;

interface HistogramRangePayload {
  counts?: number[];
  bin_edges?: number[];
  domain?: number[];
  y_max?: number;
  minimum_width?: number;
  reset_range?: number[];
  auto_range?: number[];
  active?: boolean;
}

interface Props {
  prop: JsonSchema;
  minimumProp: JsonSchema;
  maximumProp: JsonSchema;
  value: unknown;
  values: Values;
  disabled?: boolean;
  onValuesChange: (values: Values) => void;
  onSliderInteraction?: (dragging: boolean) => void;
}

const RANGE_STEPS = 1000;
const PERCENT_STEPS = 100;
const Plot = lazy(() => import("react-plotly.js"));

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pair(value: unknown, fallback: [number, number]): [number, number] {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]];
  }
  return fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function rangeFraction(value: number, lower: number, upper: number): number {
  const clipped = clamp(value, lower, upper);
  const width = upper - lower;
  const offset = clipped - lower;
  if (Number.isFinite(width) && Number.isFinite(offset)) return offset / width;
  const scale = Math.max(Math.abs(clipped), Math.abs(lower), Math.abs(upper));
  if (scale === 0) return 0;
  return (clipped / scale - lower / scale) / (upper / scale - lower / scale);
}

function rangeValue(lower: number, upper: number, fraction: number): number {
  const width = upper - lower;
  const value = Number.isFinite(width)
    ? lower + fraction * width
    : (lower / Math.max(Math.abs(lower), Math.abs(upper)) +
        fraction *
          (upper / Math.max(Math.abs(lower), Math.abs(upper)) -
            lower / Math.max(Math.abs(lower), Math.abs(upper)))) *
      Math.max(Math.abs(lower), Math.abs(upper));
  return clamp(value, lower, upper);
}

function halfSpan(lower: number, upper: number): number {
  const width = upper - lower;
  return Number.isFinite(width) ? width / 2 : upper / 2 - lower / 2;
}

function boundedAdd(value: number, offset: number): number {
  const result = value + offset;
  return Number.isFinite(result)
    ? result
    : Math.sign(offset) * Number.MAX_VALUE;
}

function widthRatio(
  lower: number,
  upper: number,
  referenceLower: number,
  referenceUpper: number,
): number {
  const width = upper - lower;
  const referenceWidth = referenceUpper - referenceLower;
  if (Number.isFinite(width) && Number.isFinite(referenceWidth)) {
    const scale = Math.max(width, referenceWidth);
    const scaledReference = referenceWidth / scale;
    if (scaledReference === 0) return Number.POSITIVE_INFINITY;
    return width / scale / scaledReference;
  }
  const scale = Math.max(
    Math.abs(lower),
    Math.abs(upper),
    Math.abs(referenceLower),
    Math.abs(referenceUpper),
  );
  const scaledWidth = upper / scale - lower / scale;
  const scaledReference = referenceUpper / scale - referenceLower / scale;
  return scaledReference === 0
    ? Number.POSITIVE_INFINITY
    : scaledWidth / scaledReference;
}

export function HistogramRangeField({
  prop,
  minimumProp,
  maximumProp,
  value,
  values,
  disabled,
  onValuesChange,
  onSliderInteraction,
}: Props) {
  const payload = useMemo(
    () =>
      value && typeof value === "object"
        ? (value as HistogramRangePayload)
        : {},
    [value],
  );
  const minimumField = String(prop["x-guidata-minimum-field"] ?? "minimum");
  const specialized =
    prop["x-guidata-histogram-presentation"] === "brightness_contrast";
  const maximumField = String(prop["x-guidata-maximum-field"] ?? "maximum");
  const hasDomain =
    Array.isArray(payload.domain) &&
    payload.domain.length === 2 &&
    payload.domain.every(
      (item) => typeof item === "number" && Number.isFinite(item),
    ) &&
    payload.domain[0] < payload.domain[1];
  const [domainMinimum, domainMaximum] = hasDomain
    ? pair(payload.domain, [0, 1])
    : [0, 1];
  const domainScale = Math.max(
    Math.abs(domainMinimum),
    Math.abs(domainMaximum),
  );
  const fallbackWidth = Math.max(
    Number.MIN_VALUE,
    Number.EPSILON * domainScale,
  );
  const configuredWidth = finiteNumber(payload.minimum_width, fallbackWidth);
  const minimumWidth = configuredWidth > 0 ? configuredWidth : fallbackWidth;
  const minimumValue = values[minimumField];
  const maximumValue = values[maximumField];
  const minimum = finiteNumber(minimumValue, domainMinimum);
  const maximum = finiteNumber(maximumValue, domainMaximum);
  const rangeValid =
    typeof minimumValue === "number" &&
    Number.isFinite(minimumValue) &&
    typeof maximumValue === "number" &&
    Number.isFinite(maximumValue) &&
    minimum < maximum;
  const center = minimum / 2 + maximum / 2;
  const active =
    payload.active === true &&
    hasDomain &&
    [payload.minimum_width, payload.y_max].every(
      (item) =>
        item === undefined ||
        (typeof item === "number" && Number.isFinite(item) && item > 0),
    ) &&
    (payload.counts === undefined ||
      (Array.isArray(payload.counts) &&
        payload.counts.every(
          (item) =>
            typeof item === "number" && Number.isFinite(item) && item >= 0,
        )));
  const constraintsValid =
    rangeValid &&
    numericValueValid(minimumProp ?? {}, minimumValue) &&
    numericValueValid(maximumProp ?? {}, maximumValue);
  const controlsDisabled = disabled || !active;
  const sliderDisabled = controlsDisabled || !rangeValid;
  const dragging = useRef(false);

  const increase = (candidate: number): number | null => {
    const increased = candidate + minimumWidth;
    return Number.isFinite(increased) && increased > candidate
      ? increased
      : nextFiniteFloat64(candidate, 1);
  };

  const decrease = (candidate: number): number | null => {
    const decreased = candidate - minimumWidth;
    return Number.isFinite(decreased) && decreased < candidate
      ? decreased
      : nextFiniteFloat64(candidate, -1);
  };

  const commitRange = (nextMinimum: number, nextMaximum: number) => {
    if (controlsDisabled) return;
    if (!Number.isFinite(nextMinimum) || !Number.isFinite(nextMaximum)) return;
    const nextWidth = nextMaximum - nextMinimum;
    if (
      nextMaximum <= nextMinimum ||
      (Number.isFinite(nextWidth) && nextWidth < minimumWidth)
    ) {
      const increased = increase(nextMinimum);
      if (increased === null) return;
      nextMaximum = increased;
    }
    onValuesChange({
      ...values,
      [minimumField]: nextMinimum,
      [maximumField]: nextMaximum,
    });
  };

  const minimumPosition = clamp(
    Math.round(
      RANGE_STEPS * rangeFraction(minimum, domainMinimum, domainMaximum),
    ),
    0,
    RANGE_STEPS,
  );
  const maximumPosition = clamp(
    Math.round(
      RANGE_STEPS * rangeFraction(maximum, domainMinimum, domainMaximum),
    ),
    0,
    RANGE_STEPS,
  );
  const brightness = clamp(
    Math.round(
      PERCENT_STEPS * (1 - rangeFraction(center, domainMinimum, domainMaximum)),
    ),
    0,
    PERCENT_STEPS,
  );
  const currentWidthRatio = widthRatio(
    minimum,
    maximum,
    domainMinimum,
    domainMaximum,
  );
  let contrast = 50 / currentWidthRatio;
  if (currentWidthRatio < 1) {
    contrast = PERCENT_STEPS - 50 * currentWidthRatio;
  }
  const contrastPosition = clamp(Math.round(contrast), 0, PERCENT_STEPS);

  const plotData = useMemo<Data[]>(() => {
    const counts =
      active && Array.isArray(payload.counts) ? payload.counts : [];
    const centers = counts.map((_, index) => (index + 0.5) / counts.length);
    const clippedMinimum = clamp(minimum, domainMinimum, domainMaximum);
    const clippedMaximum = clamp(maximum, domainMinimum, domainMaximum);
    const transferX = [
      0,
      rangeFraction(clippedMinimum, domainMinimum, domainMaximum),
      rangeFraction(clippedMaximum, domainMinimum, domainMaximum),
      1,
    ];
    const transferY = transferX.map((x) =>
      clamp(
        rangeFraction(
          rangeValue(domainMinimum, domainMaximum, x),
          minimum,
          maximum,
        ),
        0,
        1,
      ),
    );
    return [
      {
        type: "bar",
        x: centers,
        y: counts,
        marker: { color: "#7b8491" },
        hoverinfo: "skip",
      },
      {
        type: "scatter",
        mode: "lines",
        x: specialized
          ? transferX
          : [transferX[1], transferX[1], transferX[2], transferX[2]],
        fill: specialized ? undefined : "toself",
        fillcolor: specialized ? undefined : "rgba(217,119,6,0.15)",
        y: (specialized ? transferY : [0, 1, 1, 0]).map(
          (fraction) =>
            fraction * finiteNumber(payload.y_max, Math.max(...counts, 1)),
        ),
        line: { color: "#d97706", width: 2 },
        hoverinfo: "skip",
      },
    ];
  }, [
    domainMaximum,
    domainMinimum,
    maximum,
    minimum,
    payload,
    specialized,
    active,
  ]);

  const startDragging = () => {
    if (dragging.current) return;
    dragging.current = true;
    onSliderInteraction?.(true);
  };
  const stopDragging = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onSliderInteraction?.(false);
  };
  const gestureProps = {
    onPointerDown: startDragging,
    onPointerUp: stopDragging,
    onPointerCancel: stopDragging,
    onBlur: stopDragging,
  };

  const applyNamedRange = (name: "auto_range" | "reset_range") => {
    const next = pair(payload[name], [minimum, maximum]);
    commitRange(next[0], next[1]);
  };

  const hasNamedRange = (name: "auto_range" | "reset_range") => {
    const bounds = pair(payload[name], [0, 0]);
    return bounds[0] < bounds[1];
  };

  return (
    <div className="histogram-range-field">
      {typeof prop["x-guidata-label"] === "string" && (
        <div>{prop["x-guidata-label"] as string}</div>
      )}
      <div
        className="histogram-range-plot"
        role="img"
        aria-label={
          specialized
            ? t("Source histogram and transfer function")
            : t("Histogram and selected range")
        }
      >
        <Suspense fallback={null}>
          <Plot
            data={plotData}
            layout={{
              autosize: true,
              showlegend: false,
              margin: { l: 36, r: 10, t: 8, b: 28 },
              paper_bgcolor: "rgba(0,0,0,0)",
              plot_bgcolor: "rgba(0,0,0,0)",
              bargap: 0,
              xaxis: {
                range: [0, 1],
                tickvals: [0, 0.25, 0.5, 0.75, 1],
                ticktext: [0, 0.25, 0.5, 0.75, 1].map((fraction) =>
                  String(rangeValue(domainMinimum, domainMaximum, fraction)),
                ),
                fixedrange: true,
                zeroline: false,
              },
              yaxis: {
                range: [0, finiteNumber(payload.y_max, 1)],
                fixedrange: true,
                showticklabels: false,
                zeroline: false,
              },
            }}
            config={{
              displayModeBar: false,
              responsive: true,
              staticPlot: true,
            }}
            style={{ width: "100%", height: "132px" }}
            useResizeHandler
          />
        </Suspense>
      </div>
      <label className="histogram-range-control">
        <span>
          {t("Minimum")}
          {minimumProp?.["x-guidata-unit"]
            ? ` (${minimumProp["x-guidata-unit"]})`
            : ""}
        </span>
        <input
          type="range"
          aria-label={t("Minimum slider")}
          min={0}
          max={RANGE_STEPS}
          value={minimumPosition}
          disabled={sliderDisabled}
          onChange={(event) => {
            const next = rangeValue(
              domainMinimum,
              domainMaximum,
              Number(event.target.value) / RANGE_STEPS,
            );
            commitRange(next, maximum);
          }}
          {...gestureProps}
        />
        <input
          type="number"
          aria-label={t("Minimum")}
          aria-invalid={!constraintsValid}
          value={Number.isFinite(minimumValue as number) ? minimum : ""}
          step="any"
          disabled={controlsDisabled}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(next)) {
              onValuesChange({ ...values, [minimumField]: null });
              return;
            }
            commitRange(next, maximum);
          }}
        />
      </label>
      <label className="histogram-range-control">
        <span>
          {t("Maximum")}
          {maximumProp?.["x-guidata-unit"]
            ? ` (${maximumProp["x-guidata-unit"]})`
            : ""}
        </span>
        <input
          type="range"
          aria-label={t("Maximum slider")}
          min={0}
          max={RANGE_STEPS}
          value={maximumPosition}
          disabled={sliderDisabled}
          onChange={(event) => {
            const next = rangeValue(
              domainMinimum,
              domainMaximum,
              Number(event.target.value) / RANGE_STEPS,
            );
            const nextMinimum = minimum < next ? minimum : decrease(next);
            if (nextMinimum !== null) commitRange(nextMinimum, next);
          }}
          {...gestureProps}
        />
        <input
          type="number"
          aria-label={t("Maximum")}
          aria-invalid={!constraintsValid}
          value={Number.isFinite(maximumValue as number) ? maximum : ""}
          step="any"
          disabled={controlsDisabled}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(next)) {
              onValuesChange({ ...values, [maximumField]: null });
              return;
            }
            const nextMinimum = minimum < next ? minimum : decrease(next);
            if (nextMinimum !== null) commitRange(nextMinimum, next);
          }}
        />
      </label>
      {specialized && (
        <>
          <label className="histogram-range-control">
            <span>{t("Brightness")}</span>
            <input
              type="range"
              aria-label={t("Brightness")}
              min={0}
              max={PERCENT_STEPS}
              value={brightness}
              disabled={sliderDisabled}
              onChange={(event) => {
                const nextCenter = rangeValue(
                  domainMinimum,
                  domainMaximum,
                  1 - Number(event.target.value) / PERCENT_STEPS,
                );
                const halfWidth = halfSpan(minimum, maximum);
                commitRange(
                  boundedAdd(nextCenter, -halfWidth),
                  boundedAdd(nextCenter, halfWidth),
                );
              }}
              {...gestureProps}
            />
            <output>{brightness}</output>
          </label>
          <label className="histogram-range-control">
            <span>{t("Contrast")}</span>
            <input
              type="range"
              aria-label={t("Contrast")}
              min={0}
              max={PERCENT_STEPS}
              value={contrastPosition}
              disabled={sliderDisabled}
              onChange={(event) => {
                const position = Number(event.target.value);
                const domainHalfWidth = halfSpan(domainMinimum, domainMaximum);
                let halfWidth: number;
                if (position === 0) {
                  halfWidth = Number.MAX_VALUE;
                } else if (position <= 50) {
                  halfWidth = domainHalfWidth * (50 / position);
                } else if (position >= PERCENT_STEPS) {
                  halfWidth = minimumWidth / 2;
                } else {
                  halfWidth =
                    domainHalfWidth * ((PERCENT_STEPS - position) / 50);
                }
                commitRange(
                  boundedAdd(center, -halfWidth),
                  boundedAdd(center, halfWidth),
                );
              }}
              {...gestureProps}
            />
            <output>{contrastPosition}</output>
          </label>
        </>
      )}
      <div className="histogram-range-actions">
        {hasNamedRange("auto_range") && (
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={() => applyNamedRange("auto_range")}
          >
            {t("Auto")}
          </button>
        )}
        {hasNamedRange("reset_range") && (
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={() => applyNamedRange("reset_range")}
          >
            {t("Reset")}
          </button>
        )}
      </div>
    </div>
  );
}
