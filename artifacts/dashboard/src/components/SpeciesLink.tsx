import { ExternalLink } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { gbifNameUrl } from "@/lib/wiki";

export function SpeciesLink({
  name,
  taxonKey,
  className = "",
}: {
  name: string;
  taxonKey?: number;
  className?: string;
}) {
  const { t } = useLang();
  const href = taxonKey
    ? `https://www.gbif.org/species/${taxonKey}`
    : gbifNameUrl(name, "SPECIES");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={t("learnMore")}
      className={`inline-flex items-center gap-1 italic text-slate-800 hover:text-blue-600 hover:underline ${className}`}
    >
      {name}
      <ExternalLink className="w-3 h-3 opacity-50" />
    </a>
  );
}
