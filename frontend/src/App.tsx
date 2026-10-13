import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { useAuth } from "./hooks/useAuth";
import { firebaseConfigured } from "./lib/firebase";
import Consumption from "./pages/Consumption";
import Dashboard from "./pages/Dashboard";

import Login from "./pages/Login";
import EcoFlow from "./pages/EcoFlow";
import Predictions from "./pages/Predictions";
import Enedis from "./pages/Enedis";
import Database from "./pages/Database";
import Cost from "./pages/Cost";
import Tesla from "./pages/Tesla";
import Climat from "./pages/Climat";
import FeatureEngineering from "./pages/FeatureEngineering";
import LlmAnalysis from "./pages/LlmAnalysis";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user && firebaseConfigured) return <Login />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />

        <Route path="/consumption" element={<Consumption />} />
        <Route path="/ecoflow" element={<EcoFlow />} />
        <Route path="/enedis" element={<Enedis />} />
        <Route path="/cost" element={<Cost />} />
        <Route path="/predictions" element={<Predictions />} />
        <Route path="/llm" element={<LlmAnalysis />} />
        <Route path="/database" element={<Database />} />
        <Route path="/tesla" element={<Tesla />} />
        <Route path="/climat" element={<Climat />} />
        <Route path="/feature-engineering" element={<FeatureEngineering />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
