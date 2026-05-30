import { useState } from "react";
import type { ObjectMeta } from "../runtime/runtime";
import { t } from "../i18n/translate";

interface Props {
  initial: ObjectMeta;
  onSubmit: (values: ObjectMeta) => void;
  onCancel: () => void;
}

export function ObjectPropertiesDialog({ initial, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<ObjectMeta>(initial);

  const update = (key: keyof ObjectMeta, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <h2>{t("Edit metadata")}</h2>
          <div className="dialog-form">
            <label>{t("Title")}</label>
            <input
              autoFocus
              value={values.title}
              onChange={(e) => update("title", e.target.value)}
            />
            <label>{t("X label")}</label>
            <input
              value={values.xlabel}
              onChange={(e) => update("xlabel", e.target.value)}
            />
            <label>{t("X unit")}</label>
            <input
              value={values.xunit}
              onChange={(e) => update("xunit", e.target.value)}
            />
            <label>{t("Y label")}</label>
            <input
              value={values.ylabel}
              onChange={(e) => update("ylabel", e.target.value)}
            />
            <label>{t("Y unit")}</label>
            <input
              value={values.yunit}
              onChange={(e) => update("yunit", e.target.value)}
            />
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={onCancel}>
              {t("Cancel")}
            </button>
            <button type="submit">{t("OK")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
