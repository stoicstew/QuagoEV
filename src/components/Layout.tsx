import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { type ReactNode, useState } from 'react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '⚡' },
  { to: '/battery', label: 'Battery Health', icon: '🔋' },
  { to: '/costs', label: 'Cost Analytics', icon: '💰' },
  { to: '/trips', label: 'Trip History', icon: '🗺' },
  { to: '/automations', label: 'Automations', icon: '⚙' },
  { to: '/sleep', label: 'Sleep Score', icon: '😴' },
  { to: '/settings', label: 'Settings', icon: '🔧' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">QuagoEV</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Sign Out
          </button>
        </div>
      </aside>
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? '✕' : '☰'}
      </button>
      <main className="main-content">{children}</main>
    </div>
  );
}
