import { useState } from "react";
import { t } from "../i18n/translate";
import { resetDemoProfile } from "../storage/resetDemoProfile";

export function DemoProfileReset() {
  const [state, setState] = useState<"confirm" | "clearing" | "done">(
    "confirm",
  );
  const [error, setError] = useState("");
  async function clear() {
    setError("");
    setState("clearing");
    try {
      await resetDemoProfile();
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("confirm");
    }
  }
  return (
    <main>
      <h1>{t("Reset demo storage")}</h1>
      {state === "done" ? (
        <p role="status">{t("Demo storage cleared.")}</p>
      ) : (
        <>
          <p>
            {t(
              "Close other demo tabs first. This removes this demo’s preferences, plugins, recent items and caches. Stable DataLab Web and saved HDF5 files are not affected.",
            )}
          </p>
          <button disabled={state === "clearing"} onClick={() => void clear()}>
            {t("Clear demo storage")}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        <a href="./">{t("Return to demo")}</a>
      </p>
    </main>
  );
}
