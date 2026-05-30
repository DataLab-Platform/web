/**
 * Renderer for one cell's outputs (Jupyter-style).
 *
 * Supported MIME types in the MVP:
 *   - text/plain                          → <pre>
 *   - text/html                           → sanitised innerHTML (no
 *                                            DOMPurify dep yet — kept
 *                                            minimal for the MVP; the
 *                                            HTML comes from trusted
 *                                            ``_repr_html_`` of Sigima
 *                                            result wrappers)
 *   - image/png                           → <img src="data:image/png;..."/>
 *   - application/vnd.plotly.v1+json      → react-plotly.js Figure
 *
 * Streams (stdout/stderr) are aggregated and rendered as a single
 * coloured ``<pre>``.
 */

import type { ReactElement } from "react";
import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { CellOutput } from "../../notebook/types";
import type { MimeBundle } from "../../notebook/NotebookRuntime";
import { t } from "../../i18n/translate";

interface OutputAreaProps {
  outputs: CellOutput[];
}

export function OutputArea({ outputs }: OutputAreaProps): ReactElement {
  // Coalesce consecutive ``stream`` outputs of the same kind so the user
  // sees one block per ``stdout`` / ``stderr`` run, like Jupyter.
  const coalesced = useMemo(() => coalesceStreams(outputs), [outputs]);
  return (
    <div className="nb-output-area">
      {coalesced.map((out, idx) => (
        <OutputBlock key={idx} output={out} />
      ))}
    </div>
  );
}

function OutputBlock({ output }: { output: CellOutput }): ReactElement | null {
  switch (output.type) {
    case "stream":
      return (
        <pre
          className={`nb-output-stream nb-output-${output.kind}`}
          style={{
            margin: 0,
            padding: "4px 8px",
            color: output.kind === "stderr" ? "#c4302b" : undefined,
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          {output.text}
        </pre>
      );
    case "error":
      return (
        <pre
          className="nb-output-error"
          style={{
            margin: 0,
            padding: "4px 8px",
            color: "#c4302b",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          {output.traceback || `${output.ename}: ${output.evalue}`}
        </pre>
      );
    case "display_data":
    case "execute_result":
      return <MimeRenderer bundle={output.data} />;
    default:
      return null;
  }
}

function MimeRenderer({ bundle }: { bundle: MimeBundle }): ReactElement | null {
  // Priority order: rich → plain text fallback. Mirrors Jupyter.
  if (bundle["application/vnd.plotly.v1+json"]) {
    const fig = bundle["application/vnd.plotly.v1+json"] as {
      data?: unknown[];
      layout?: Record<string, unknown>;
      config?: Record<string, unknown>;
    };
    return (
      <div className="nb-output-plotly" style={{ padding: 4 }}>
        <Plot
          data={(fig.data ?? []) as Plotly.Data[]}
          layout={(fig.layout ?? {}) as Partial<Plotly.Layout>}
          config={
            (fig.config ?? { responsive: true }) as Partial<Plotly.Config>
          }
          style={{ width: "100%" }}
          useResizeHandler
        />
      </div>
    );
  }
  if (bundle["image/png"]) {
    const png = bundle["image/png"] as string;
    return (
      <div className="nb-output-image" style={{ padding: 4 }}>
        <img
          src={`data:image/png;base64,${png}`}
          alt={t("cell output")}
          style={{ maxWidth: "100%" }}
        />
      </div>
    );
  }
  if (bundle["image/svg+xml"]) {
    const svg = bundle["image/svg+xml"] as string;
    return (
      <div
        className="nb-output-svg"
        style={{ padding: 4 }}
        // SVG comes from ``_repr_svg_`` of trusted Python objects.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  if (bundle["text/html"]) {
    const html = bundle["text/html"] as string;
    return (
      <div
        className="nb-output-html"
        style={{ padding: 4 }}
        // The HTML originates from ``_repr_html_`` of Sigima result
        // wrappers (TableResultDisplay / GeometryResultDisplay) — i.e.
        // first-party trusted output. A DOMPurify pass will be added
        // before any third-party sources are wired in.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (bundle["text/markdown"]) {
    return (
      <pre
        className="nb-output-text"
        style={{ margin: 0, padding: "4px 8px", whiteSpace: "pre-wrap" }}
      >
        {String(bundle["text/markdown"])}
      </pre>
    );
  }
  if (bundle["text/plain"]) {
    return (
      <pre
        className="nb-output-text"
        style={{
          margin: 0,
          padding: "4px 8px",
          whiteSpace: "pre-wrap",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        {String(bundle["text/plain"])}
      </pre>
    );
  }
  return null;
}

function coalesceStreams(outputs: CellOutput[]): CellOutput[] {
  const out: CellOutput[] = [];
  for (const o of outputs) {
    if (o.type === "stream" && out.length > 0) {
      const prev = out[out.length - 1];
      if (prev.type === "stream" && prev.kind === o.kind) {
        out[out.length - 1] = {
          type: "stream",
          kind: o.kind,
          text: prev.text + o.text,
        };
        continue;
      }
    }
    out.push(o);
  }
  return out;
}
