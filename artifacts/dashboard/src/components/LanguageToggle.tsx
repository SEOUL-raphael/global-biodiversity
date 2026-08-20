import { Languages, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useLang, LANG_LABELS, type Lang } from "@/lib/i18n";

const ORDER: Lang[] = ["en", "zh", "es", "ar", "fr", "ru", "ko"];

export function LanguageToggle() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-1.5 bg-slate-800/60 rounded-lg px-2 py-1.5 border border-slate-700 hover:bg-slate-800 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Languages className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-xs font-medium text-white truncate">
            {LANG_LABELS[lang]}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 left-0 right-0 bg-slate-800 border border-slate-700 rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto"
        >
          {ORDER.map((l) => (
            <li key={l}>
              <button
                onClick={() => {
                  setLang(l);
                  setOpen(false);
                }}
                role="option"
                aria-selected={lang === l}
                className={`w-full text-left flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors ${
                  lang === l
                    ? "bg-emerald-600 text-white"
                    : "text-slate-200 hover:bg-slate-700"
                }`}
              >
                <span>{LANG_LABELS[l]}</span>
                <span className="text-[10px] uppercase opacity-60 font-mono">{l}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
