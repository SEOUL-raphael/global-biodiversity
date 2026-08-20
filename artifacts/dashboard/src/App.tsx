import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/not-found";
import Overview from "@/pages/Overview";
import Hotspots from "@/pages/Hotspots";
import ThreatDistribution from "@/pages/ThreatDistribution";
import OccurrenceTrends from "@/pages/OccurrenceTrends";
import SpeciesSearch from "@/pages/SpeciesSearch";
import SpeciesDetail from "@/pages/SpeciesDetail";
import Insights from "@/pages/Insights";
import AiQuery from "@/pages/AiQuery";
import McpPage from "@/pages/Mcp";
import About from "@/pages/About";
import { LanguageProvider, useLang } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";
import {
  Globe,
  AlertTriangle,
  ShieldAlert,
  TrendingUp,
  Search,
  BrainCircuit,
  Cpu,
  Leaf,
  Menu,
  X,
  Network,
} from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

const NAV = [
  { path: "/", labelKey: "navOverview", icon: Globe },
  { path: "/hotspots", labelKey: "navHotspots", icon: AlertTriangle },
  { path: "/threat-distribution", labelKey: "navThreat", icon: ShieldAlert },
  { path: "/trends", labelKey: "navTrends", icon: TrendingUp },
  { path: "/species", labelKey: "navSpecies", icon: Search },
  { path: "/insights", labelKey: "navInsights", icon: Network },
  { path: "/ai", labelKey: "navAi", icon: BrainCircuit },
  { path: "/mcp", labelKey: "navMcp", icon: Cpu },
] as const;

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { t } = useLang();
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-700">
        <Leaf className="w-6 h-6 text-emerald-400" />
        <span className="font-bold text-sm tracking-wide text-white">{t("appTitle")}</span>
      </div>
      <div className="px-3 py-3 border-b border-slate-700">
        <LanguageToggle />
      </div>
      <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
        {NAV.map(({ path, labelKey, icon: Icon }) => {
          const active =
            location === path || (path !== "/" && location.startsWith(path));
          return (
            <Link key={path} href={path} onClick={onNavigate}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t(labelKey)}
              </div>
            </Link>
          );
        })}
      </nav>
      <Link href="/about" onClick={onNavigate}>
        <div className="px-5 py-4 border-t border-slate-700 text-xs text-slate-500 hover:text-emerald-300 hover:bg-slate-800/60 transition-colors cursor-pointer flex items-center gap-1">
          <span>{t("appFooter")}</span>
          <span className="opacity-70">→</span>
        </div>
      </Link>
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [location] = useLocation();
  const { t } = useLang();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location]);

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden md:flex w-60 shrink-0 bg-slate-900 text-slate-100 flex-col min-h-screen">
        <SidebarContent />
      </aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-30 bg-slate-900 text-white flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-1.5 rounded hover:bg-slate-800"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Leaf className="w-5 h-5 text-emerald-400" />
          <span className="font-bold text-sm">{t("appTitle")}</span>
        </div>
        <div className="w-7" />
      </div>

      {drawerOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="md:hidden fixed left-0 top-0 bottom-0 w-72 bg-slate-900 text-slate-100 z-50 flex flex-col shadow-2xl">
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded hover:bg-slate-800 z-10"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </>
      )}

      <main className="flex-1 overflow-auto p-4 sm:p-6 pt-16 md:pt-6 max-w-full">
        {children}
      </main>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Overview} />
        <Route path="/overview" component={Overview} />
        <Route path="/hotspots" component={Hotspots} />
        <Route path="/threat-distribution" component={ThreatDistribution} />
        <Route path="/trends" component={OccurrenceTrends} />
        <Route path="/species/:taxonKey" component={SpeciesDetail} />
        <Route path="/species" component={SpeciesSearch} />
        <Route path="/insights" component={Insights} />
        <Route path="/ai" component={AiQuery} />
        <Route path="/mcp" component={McpPage} />
        <Route path="/about" component={About} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;
