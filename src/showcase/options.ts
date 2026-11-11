/**
 * Options of the showcase mode and parsing of its kiosk URL parameters.
 * Part of the lazily loaded showcase chunk: the main bundle only checks
 * whether the URL requests the showcase (see ``./launch``).
 */

export type ShowcasePace = "slow" | "normal" | "fast";

/** Pace multipliers offered by the Showcase mode dialog. */
export const PACE_SPEED: Record<ShowcasePace, number> = {
  slow: 1.4,
  normal: 1,
  fast: 0.65,
};

/** Default number of loops between two page reloads (kiosk loop only). */
export const DEFAULT_RELOAD_EVERY = 5;

export interface ShowcaseOptions {
  /** Ids of the scenarios to play, in registry order; ``null`` plays all. */
  ids: string[] | null;
  /** Play the selection again and again. */
  loop: boolean;
  /** Pace multiplier of every pause and pointer motion (1 = normal). */
  speed: number;
  /** Developer check mode: no pauses, no overlays, a single pass, results
   *  published in ``window.__showcase`` (``?check=1`` or ``?speed=0``). */
  check: boolean;
  /** Reload the page every N loops to start afresh (kiosk loop only;
   *  0 = never). The URL is kept, so the showcase restarts by itself. */
  reloadEvery: number;
  /** Started from the URL (kiosk) rather than from the Help menu. */
  fromUrl: boolean;
  /** Close the browser window after one pass (``?close=1``): a "web
   *  interlude" opened by DataLab desktop in a dedicated app window, which
   *  waits for the browser to exit. Implies a single pass. */
  close: boolean;
}

function isTrue(value: string | null): boolean {
  return value !== null && ["1", "true", "yes", "on"].includes(value.trim());
}

/**
 * Parse the kiosk URL parameters: ``showcase=1`` (or ``all``) plays every
 * scenario, ``showcase=w1,w2`` a selection; ``loop=1`` loops, ``speed=0.7``
 * sets the pace, ``reload=N`` reloads the page every N loops (default 5,
 * 0 = never), ``close=1`` closes the window after one pass and
 * ``check=1`` (or ``speed=0``) selects the check mode.
 * Returns ``null`` when the URL does not request the showcase.
 */
export function parseShowcaseParams(search: string): ShowcaseOptions | null {
  const params = new URLSearchParams(search);
  const raw = params.get("showcase");
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (["", "0", "false", "no", "off"].includes(value)) return null;
  const ids = ["1", "all", "true", "yes", "on"].includes(value)
    ? []
    : [
        ...new Set(
          value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
  const speedValue = Number(params.get("speed"));
  const speed =
    params.has("speed") && Number.isFinite(speedValue) && speedValue >= 0
      ? speedValue
      : 1;
  const check = isTrue(params.get("check")) || speed === 0;
  const close = !check && isTrue(params.get("close"));
  const reloadValue = Number(params.get("reload"));
  return {
    ids: ids.length > 0 ? ids : null,
    loop: !check && !close && isTrue(params.get("loop")),
    speed: check ? 0 : speed,
    check,
    reloadEvery:
      params.has("reload") && Number.isInteger(reloadValue) && reloadValue >= 0
        ? reloadValue
        : DEFAULT_RELOAD_EVERY,
    fromUrl: true,
    close,
  };
}
