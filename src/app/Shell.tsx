import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { BarChart3, LayoutGrid, List, Plus, Settings } from 'lucide-react';
import { useExpenseActions } from './AddExpenseProvider';

const NAV = [
  { to: '/', label: 'Overview', Icon: LayoutGrid, end: true },
  { to: '/transactions', label: 'Transactions', Icon: List, end: false },
  { to: '/insights', label: 'Insights', Icon: BarChart3, end: false },
  { to: '/settings', label: 'Settings', Icon: Settings, end: false },
];

export function Shell() {
  const { openAdd } = useExpenseActions();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page on navigation so keyboard/screen-reader users land at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/" className="brand" aria-label="WEEKLY — Overview">
            <span className="brand__mark" aria-hidden />
            <span className="brand__word">WEEKLY</span>
          </NavLink>
          <nav className="nav nav--top" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="nav__link">
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button type="button" className="btn btn--primary btn--add" onClick={() => openAdd()} title="Add expense (N)">
            <Plus size={18} aria-hidden />
            <span>Add expense</span>
          </button>
        </div>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className="main">
        <Outlet />
      </main>

      <nav className="nav nav--bottom" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav__link">
            <n.Icon size={20} aria-hidden />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
