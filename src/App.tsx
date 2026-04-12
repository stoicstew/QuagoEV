import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './components/Login';
import Callback from './components/Callback';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import BatteryHealth from './components/BatteryHealth';
import CostAnalytics from './components/CostAnalytics';
import TripHistory from './components/TripHistory';
import Automations from './components/Automations';
import SleepScore from './components/SleepScore';
import Settings from './components/Settings';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { authenticated, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /><p>Loading QuagoEV...</p></div>;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/callback" element={<Callback />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/battery" element={<BatteryHealth />} />
                <Route path="/costs" element={<CostAnalytics />} />
                <Route path="/trips" element={<TripHistory />} />
                <Route path="/automations" element={<Automations />} />
                <Route path="/sleep" element={<SleepScore />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
