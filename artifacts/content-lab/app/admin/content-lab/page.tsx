import { ContentLabForm } from "./ContentLabForm";

export const dynamic = "force-dynamic";

export default function ContentLabPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-white">
        Threads Content Engine
      </h1>
      <p className="mb-6 mt-1 text-sm text-slate-400">
        Идея → уникальный текст → картинка (SeedDream) → draft или публикация.
        Заполни <code>DATABASE_URL</code>, сделай <code>pnpm -C lib/db run push</code>{" "}
        (из корня репо), env для Threads, OpenAI/Gemini, <code>FAL_KEY</code>.
      </p>
      <ContentLabForm />
    </div>
  );
}
