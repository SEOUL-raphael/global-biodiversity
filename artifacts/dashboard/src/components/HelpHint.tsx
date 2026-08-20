import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function HelpHint({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={`inline-flex items-center text-slate-400 hover:text-slate-600 transition-colors ${className}`}
          onClick={(e) => e.preventDefault()}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="max-w-xs sm:max-w-sm whitespace-normal text-left leading-relaxed"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
