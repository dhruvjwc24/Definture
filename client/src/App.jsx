import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout, { useNav } from './Layout.jsx';
import Login from './pages/Login.jsx';
import { Executive, Plant, SupplyDash } from './pages/Dashboards.jsx';
import LogEntry from './pages/LogEntry.jsx';
import Logs from './pages/Logs.jsx';
import { QualityReport, OeeReport, DowntimeReport, BalanceReport } from './pages/Reports.jsx';
import { Inventory, PurchaseOrders, Shipments } from './pages/Supply.jsx';
import DataPage from './pages/DataPage.jsx';
import Lifecycle from './pages/Lifecycle.jsx';
import { Users, Roles, Config, AuditLog } from './pages/Admin.jsx';
import { Loading } from './ui.jsx';

const Guard = ({ perm, action = 'r', children }) => {
  const { can } = useAuth();
  return can(perm, action) ? children : <div className="alert">You do not have access to this page.</div>;
};

function Home() {
  const nav = useNav();
  const first = nav[0]?.items[0];
  return first ? <Navigate to={first.to} replace /> : <div className="alert info">Your role has no menu access yet. Ask your administrator.</div>;
}

export default function App() {
  const { session, loading } = useAuth();
  if (loading) return <Loading text="Signing in…" />;
  if (!session) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="dashboard/executive" element={<Guard perm="dashboard.executive"><Executive /></Guard>} />
        <Route path="dashboard/plant" element={<Guard perm="dashboard.plant"><Plant /></Guard>} />
        <Route path="dashboard/supply" element={<Guard perm="supply.dashboard"><SupplyDash /></Guard>} />
        <Route path="shopfloor/new" element={<Guard perm="production_logs" action="c"><LogEntry /></Guard>} />
        <Route path="shopfloor/logs" element={<Guard perm="production_logs"><Logs /></Guard>} />
        <Route path="reports/quality" element={<Guard perm="report.quality"><QualityReport /></Guard>} />
        <Route path="reports/oee" element={<Guard perm="report.oee"><OeeReport /></Guard>} />
        <Route path="reports/downtime" element={<Guard perm="report.downtime"><DowntimeReport /></Guard>} />
        <Route path="reports/balance" element={<Guard perm="report.balance"><BalanceReport /></Guard>} />
        <Route path="supply/inventory" element={<Guard perm="inventory_levels"><Inventory /></Guard>} />
        <Route path="supply/purchase-orders" element={<Guard perm="purchase_orders"><PurchaseOrders /></Guard>} />
        <Route path="supply/shipments" element={<Guard perm="shipments"><Shipments /></Guard>} />
        <Route path="lifecycle/:id?" element={<Guard perm="parts"><Lifecycle /></Guard>} />
        <Route path="data/:entity" element={<DataPage />} />
        <Route path="admin/users" element={<Guard perm="users"><Users /></Guard>} />
        <Route path="admin/roles" element={<Guard perm="roles"><Roles /></Guard>} />
        <Route path="admin/config" element={<Guard perm="settings"><Config /></Guard>} />
        <Route path="admin/audit" element={<Guard perm="audit"><AuditLog /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
