import { useState } from "react";
import { t } from "../i18n/translate";
import type { RuntimeApi } from "../runtime/runtime";

/** Private, loopback-only build. No dev hooks, scripting or arbitrary shapes. */
export function QualificationPanel({
  runtime,
  onCreated,
}: {
  runtime: RuntimeApi;
  onCreated: (oid: string) => Promise<void>;
}) {
  const [tier, setTier] = useState("smoke");
  const [consent, setConsent] = useState("");
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setResult("");
    try {
      setResult(JSON.stringify(await fn()));
    } catch (err) {
      setResult(JSON.stringify({ error: String(err) }));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section data-testid="qualification">
      <strong>{t("Dedicated machine qualification")}</strong>{" "}
      <select
        aria-label={t("Fixed tier")}
        value={tier}
        disabled={started}
        onChange={(e) => setTier(e.target.value)}
      >
        {["smoke", "2048", "8192", "18432"].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>{" "}
      <input
        aria-label={t("Tier confirmation")}
        placeholder={`DEDICATED:${tier}`}
        value={consent}
        disabled={started}
        onChange={(e) => setConsent(e.target.value)}
      />
      <button
        disabled={busy || started || consent !== `DEDICATED:${tier}`}
        onClick={() =>
          void run(async () => {
            setStarted(true);
            const ids = await runtime.prepareQualification(tier, consent);
            await onCreated(ids[0]);
            return { ids };
          })
        }
      >
        {t("Generate pair")}
      </button>
      <button
        disabled={busy}
        onClick={() => void run(() => runtime.qualificationDiagnostics(false))}
      >
        {t("Read diagnostics")}
      </button>
      <button
        disabled={!started || busy}
        onClick={() => void run(() => runtime.qualificationDiagnostics(true))}
      >
        {t("Check addition")}
      </button>
      <output data-testid="qualification-report" hidden>
        {result}
      </output>
      {result.startsWith('{"error"') && (
        <p role="alert">{JSON.parse(result).error}</p>
      )}
    </section>
  );
}
