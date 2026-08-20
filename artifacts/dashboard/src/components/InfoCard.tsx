import { useState } from "react";
import { Info, Cog, ChevronDown, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useLang } from "@/lib/i18n";

export function InfoCard({
  source,
  method,
  defaultOpen = false,
}: {
  source: string;
  method: string;
  defaultOpen?: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-blue-50/60 border border-blue-100 rounded-xl text-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-blue-50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 text-blue-900 font-medium">
          <Info className="w-4 h-4 shrink-0" />
          <span className="text-xs uppercase tracking-wide">
            {t("dataSource")} · {t("methodology")}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-blue-700 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-blue-100 pt-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex gap-3 items-start">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <Info className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-blue-900 text-xs uppercase tracking-wide">
                  {t("dataSource")}
                </p>
                <p className="text-slate-700 mt-1 leading-relaxed">{source}</p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Cog className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-emerald-900 text-xs uppercase tracking-wide">
                  {t("methodology")}
                </p>
                <p className="text-slate-700 mt-1 leading-relaxed">{method}</p>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Link
              href="/about"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
            >
              {t("learnMoreAboutData")}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
