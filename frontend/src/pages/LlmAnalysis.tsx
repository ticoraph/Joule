import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface ModelMetrics {
  mae?: number;
  rmse?: number;
  r2?: number;
  mean_quantile_loss?: number;
}

interface LlmReport {
  timestamp: string;
  model_llm: string;
  inference_time_seconds: number;
  analysis: string;
  data_sources: string[];
  metrics_summary: Record<string, ModelMetrics>;
}

const colors: Record<string, string> = {
  Chronos2: "#38bdf8",
  TimesFM: "#f472b6",
  XGBoost: "#facc15",
  Average: "#4ade80",
  Prophet: "#a855f7"
};

function formatText(rawText: string) {
  // Supprimer les balises <think>...</think> de Qwen3
  const text = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  const renderInline = (str: string) => {
    const parts = str.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, index) => 
      part.startsWith('**') && part.endsWith('**') ? 
        <strong key={index} className="font-semibold text-emerald-100">{part.slice(2, -2)}</strong> : 
        part
    );
  };

  return text.split('\n').map((line, i) => {
    const key = `line-${i}`;
    const trimmed = line.trim();
    
    // Ignorer les lignes de séparation de tableaux markdown
    if (trimmed.startsWith('|---') || trimmed === '---') {
      return null;
    }
    
    if (line.startsWith('#### ')) {
      return <h4 key={key} className="text-lg font-bold mt-5 mb-2 text-emerald-200">{renderInline(line.replace('#### ', ''))}</h4>;
    } else if (line.startsWith('### ')) {
      return <h3 key={key} className="text-xl font-bold mt-6 mb-3 text-white">{renderInline(line.replace('### ', ''))}</h3>;
    } else if (line.startsWith('## ')) {
      return <h2 key={key} className="text-2xl font-bold mt-8 mb-4 text-white">{renderInline(line.replace('## ', ''))}</h2>;
    } else if (line.startsWith('# ')) {
      return <h1 key={key} className="text-3xl font-bold mt-10 mb-5 text-white">{renderInline(line.replace('# ', ''))}</h1>;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      return <li key={key} className="ml-6 mb-2 list-disc text-slate-300">{renderInline(line.substring(2))}</li>;
    } else if (trimmed === '') {
      return <div key={key} className="h-4"></div>;
    } else {
      return <p key={key} className="mb-3 text-slate-300 leading-relaxed">{renderInline(line)}</p>;
    }
  });
}

export default function LlmAnalysis() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["llm", "report"],
    queryFn: () => api<LlmReport>("/llm/reports/latest"),
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0c1f35 100%)",
      padding: "32px 24px",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-4">
            Analyse LLM 🧠
          </h1>
          {data && (
            <div className="flex flex-wrap gap-4 items-center text-sm">
              <span className="px-3 py-1 rounded-full bg-slate-800/80 text-blue-300 border border-blue-500/30 backdrop-blur-sm">
                🤖 {data.model_llm}
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-800/80 text-slate-300 border border-slate-600/50 backdrop-blur-sm">
                🕒 {new Date(data.timestamp).toLocaleString()}
              </span>
            </div>
          )}
        </header>

        {isLoading && (
          <div className="animate-pulse space-y-6">
            <div className="h-32 bg-slate-800/50 rounded-2xl border border-white/5"></div>
            <div className="h-96 bg-slate-800/50 rounded-2xl border border-white/5"></div>
          </div>
        )}

        {isError && (
           <div className="p-8 rounded-2xl bg-red-900/20 border border-red-500/30 backdrop-blur-md text-red-200">
             <p className="text-lg">Erreur lors du chargement du rapport LLM.</p>
           </div>
        )}

        {!isLoading && !isError && !data && (
          <div className="p-12 text-center rounded-3xl bg-slate-800/30 border border-white/10 backdrop-blur-md">
            <span className="text-6xl mb-6 block">📝</span>
            <h3 className="text-2xl font-medium text-slate-200 mb-4">Aucun rapport disponible</h3>
            <p className="text-slate-400">Lancez le script d'analyse : <code className="bg-slate-900 px-2 py-1 rounded text-emerald-400">python scripts/analysis_llm.py</code></p>
          </div>
        )}

        {data && (
          <div className="space-y-8">
            <section>
              <h2 className="text-2xl font-bold text-slate-200 mb-4">Performances des Modèles</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(data.metrics_summary).map(([model, metrics]) => {
                  const color = colors[model] || "#94a3b8";
                  return (
                    <div key={model} className="p-5 rounded-2xl bg-slate-800/40 border border-white/10 backdrop-blur-md hover:bg-slate-800/60 transition-colors">
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2" style={{ color }}>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></div>
                        {model}
                      </h3>
                      <div className="space-y-2 text-sm text-slate-300">
                        <div className="flex justify-between">
                          <span className="text-slate-500">MAE</span>
                          <span className="font-mono">{metrics.mae != null ? metrics.mae.toFixed(2) : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">RMSE</span>
                          <span className="font-mono">{metrics.rmse != null ? metrics.rmse.toFixed(2) : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">R²</span>
                          <span className="font-mono">{metrics.r2 != null ? metrics.r2.toFixed(3) : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500" title="Mean Quantile Loss">MQL</span>
                          <span className="font-mono">{metrics.mean_quantile_loss != null ? metrics.mean_quantile_loss.toFixed(3) : "—"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="p-8 rounded-3xl bg-slate-800/30 border border-white/10 backdrop-blur-xl shadow-2xl">
              <h2 className="text-xl font-semibold text-emerald-400/90 mb-6 uppercase tracking-wider text-sm">Analyse Détaillée</h2>
              <div className="prose prose-invert max-w-none">
                {formatText(data.analysis)}
              </div>
            </section>

            <footer className="pt-6 border-t border-slate-700/50 flex flex-wrap gap-6 text-sm text-slate-500">
              <div>
                <strong className="text-slate-400">Temps d'inférence:</strong> {data.inference_time_seconds.toFixed(1)}s
              </div>
              <div>
                <strong className="text-slate-400">Sources:</strong> {data.data_sources.join(', ')}
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
