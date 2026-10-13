import { Link, useMatch } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Sidebar() {
  const { logout } = useAuth();
  const onDashboard = !!useMatch("/");

  const onEcoFlow = !!useMatch("/ecoflow");
  const onEnedis = !!useMatch("/enedis");
  const onCost = !!useMatch("/cost");
  const onConsumption = !!useMatch("/consumption");
  const onPredictions = !!useMatch("/predictions");
  const onLlm = !!useMatch("/llm");
  const onDatabase = !!useMatch("/database");
  const onTesla = !!useMatch("/tesla");
  const onClimat = !!useMatch("/climat");
  const onFeatureEngineering = !!useMatch("/feature-engineering");

  const linkClass = (active: boolean) =>
    `mb-1 block rounded px-2 py-1 font-semibold ${
      active ? "bg-indigo-100 text-indigo-700" : "text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-auto border-r bg-white">
      <Link to="/" className="block border-b px-4 py-4 text-xl font-bold">
        Joule
      </Link>

      <nav className="px-2 py-2 text-sm">
        <Link to="/" className={linkClass(onDashboard)}>
          Tableau de bord 📊
        </Link>

        <div className="my-2 border-t" />

        <Link to="/feature-engineering" className={linkClass(onFeatureEngineering)}>
          Feature Engineering ⚙️
        </Link>
        <Link to="/predictions" className={linkClass(onPredictions)}>
          Prédictions 🔮
        </Link>
        <Link to="/llm" className={linkClass(onLlm)}>
          Analyse LLM 🧠
        </Link>

        <div className="my-2 border-t" />

        <Link to="/enedis" className={linkClass(onEnedis)}>
          Enedis ⚡
        </Link>
        <Link to="/ecoflow" className={linkClass(onEcoFlow)}>
          EcoFlow ☀️
        </Link>
        <Link to="/tesla" className={linkClass(onTesla)}>
          Tesla 🚗
        </Link>
        <Link to="/climat" className={linkClass(onClimat)}>
          Climat 🌤️
        </Link>
        <Link to="/cost" className={linkClass(onCost)}>
          Coût 💵
        </Link>

        <div className="my-2 border-t" />

        <Link to="/database" className={linkClass(onDatabase)}>
          Tables BDD 🗄️
        </Link>
        <Link to="/consumption" className={linkClass(onConsumption)}>
          Données Fournisseurs 🧾
        </Link>
      </nav>

      <div className="mt-auto px-2 py-2 text-sm">
        <button onClick={logout} className={`w-full text-left ${linkClass(false)}`}>
          Se déconnecter
        </button>
      </div>
    </aside>
  );
}
