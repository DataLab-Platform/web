/**
 * SeparateViewDialog — full-screen modal hosting the current
 * selection's plot.
 *
 * Mirrors DataLab desktop's ``View > View in a new window…`` action,
 * which detaches the plot panel into a top-level Qt dialog so the
 * user can see the figure without the surrounding tree / side panel.
 *
 * In the browser we approximate this with a near-fullscreen modal
 * overlay (no real ``window.open`` — that would force us to share a
 * React tree across documents, which is out of scope for the first
 * iteration).  The plot renders read-only: ROI editing, contrast
 * tools and similar interactive controls stay in the main window.
 */

import { useEffect } from "react";
import { ImagePlot } from "./ImagePlot";
import { SignalPlot } from "./SignalPlot";
import type {
  ImageData,
  PlotlyAnnotations,
  SignalData,
  SignalRoiSegment,
  ImageRoiSegment,
} from "../runtime/runtime";
import type { AnalysisResult } from "../runtime/runtime";

interface SignalContent {
  kind: "signal";
  data: SignalData;
  oid: string | null;
  annotations: PlotlyAnnotations;
  roi: SignalRoiSegment[];
  results: AnalysisResult[];
  extraSignals: SignalData[];
}

interface ImageContent {
  kind: "image";
  data: ImageData;
  roi: ImageRoiSegment[];
  results: AnalysisResult[];
  lutRange: [number, number] | null;
}

export type SeparateViewContent = SignalContent | ImageContent;

interface Props {
  content: SeparateViewContent;
  showResultsOverlay: boolean;
  showGraphicalTitles: boolean;
  onClose: () => void;
}

export function SeparateViewDialog({
  content,
  showResultsOverlay,
  showGraphicalTitles,
  onClose,
}: Props) {
  // Close on Escape — same convention as the existing ConfirmDialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div
        className="card separate-view-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(92vw, 1400px)",
          height: "min(88vh, 900px)",
          display: "flex",
          flexDirection: "column",
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <h2 style={{ margin: 0 }}>{content.data.title || "Plot"}</h2>
          <button onClick={onClose} aria-label="Close popout view">
            Close
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {content.kind === "signal" ? (
            <SignalPlot
              data={content.data}
              oid={content.oid}
              annotations={content.annotations}
              // Read-only popout: silently swallow annotation edits so
              // the popout never mutates the underlying object.
              onAnnotationsChange={() => {}}
              roi={content.roi}
              roiEditMode={false}
              results={content.results}
              showResultsOverlay={showResultsOverlay}
              showGraphicalTitles={showGraphicalTitles}
              extraSignals={content.extraSignals}
            />
          ) : (
            <ImagePlot
              data={content.data}
              roi={content.roi}
              roiEditMode={false}
              results={content.results}
              showResultsOverlay={showResultsOverlay}
              showGraphicalTitles={showGraphicalTitles}
              lutRange={content.lutRange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
