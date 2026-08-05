export default function ModelLoadingFallback({ rtl }: { rtl: boolean }) {
  return (
    <div className="universe-model-loading" role="status" aria-live="polite">
      <span className="model-loading-ring" aria-hidden />
      <strong>{rtl ? "جارٍ تحميل التشريح" : "Loading anatomy"}</strong>
      <small>{rtl ? "إعداد النموذج التفاعلي" : "Preparing the interactive model"}</small>
    </div>
  );
}
