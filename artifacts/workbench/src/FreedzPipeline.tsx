import { ArrowRight, Hash, ImageIcon, Send, Share2, Sparkles } from "lucide-react";

const steps = [
  {
    id: "sources",
    title: "Источники",
    sub: "Каналы, конкуренты, списки",
    body: "Сюда «подцепим» ссылки, страницы, что вы скажете. Пока — заглушка.",
    status: "draft" as const,
    icon: Hash,
  },
  {
    id: "ingest",
    title: "Сбор текста",
    sub: "Сырые посты и сниппеты",
    body: "Нормализация и дедуп; без этого не поедет стиль и картинка.",
    status: "draft" as const,
    icon: Share2,
  },
  {
    id: "gemini",
    title: "Gemini",
    sub: "Ваш тон, не чужой",
    body: "Пересборка под ваш стиль (промпты и примеры — позже, по вашему списку).",
    status: "planned" as const,
    icon: Sparkles,
  },
  {
    id: "fal",
    title: "Fal.ai (или иная сеть)",
    sub: "Картинка по смыслу",
    body: "По тексту/рефу — портрет в кадре, сцена, визуал под пост.",
    status: "planned" as const,
    icon: ImageIcon,
  },
  {
    id: "freedz",
    title: "Freedz API",
    sub: "Пост + медиа",
    body: "Публикация во Freedz: текст и вложенное изображение.",
    status: "planned" as const,
    icon: Send,
  },
];

const statusLabel: Record<
  (typeof steps)[number]["status"],
  { text: string; className: string }
> = {
  draft: { text: "черновик", className: "border-white/10 bg-white/5 text-white/45" },
  planned: {
    text: "в плане",
    className: "border-[#5b8def]/30 bg-[#5b8def]/10 text-[#5b8def]/90",
  },
};

export function FreedzPipeline() {
  return (
    <div>
      <ol className="relative space-y-0">
        {steps.map((s, i) => {
          const St = s.icon;
          return (
            <li key={s.id} className="relative flex gap-0 md:gap-4">
              <div className="hidden w-8 shrink-0 flex-col items-center md:flex">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/8 bg-white/[0.04] text-white/60"
                  aria-hidden
                >
                  <St className="h-4 w-4" />
                </div>
                {i < steps.length - 1 && (
                  <div
                    className="my-0.5 w-px min-h-8 flex-1"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(91,141,239,0.4), rgba(42,42,53,0.5))",
                    }}
                  />
                )}
              </div>
              <div
                className={`card-glass mb-3 flex-1 rounded-xl p-4 md:mb-4 ${i === 0 ? "ml-0" : ""}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="font-sans text-base font-semibold text-white">
                    {i + 1}. {s.title}
                  </h3>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusLabel[s.status].className}`}
                  >
                    {statusLabel[s.status].text}
                  </span>
                </div>
                <p className="text-xs text-[#6b6b7a]">{s.sub}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  {s.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex items-center justify-center gap-1 text-xs text-white/30 md:hidden">
        <span>Линия потока</span>
        <ArrowRight className="h-3 w-3" />
        <span>сверху вниз</span>
      </div>
    </div>
  );
}
