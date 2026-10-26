import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, LogOut, User, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface NavbarProps {
  onToggleMobileMenu: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleMobileMenu }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { info } = useToast();

  const handleLogout = () => {
    logout();
    info('Logged out successfully');
    navigate('/login');
  };

  // Determine breadcrumb items based on current path
  const getBreadcrumbs = () => {
    const path = location.pathname;
    if (path === '/staff/entry') {
      return [
        { label: 'Staff Portal', path: '/staff' },
        { label: 'Entry', path: '/staff/entry' },
        { label: 'Clients & Sweet Distribution', path: '/staff/entry' },
      ];
    }
    if (path === '/staff/add' || path === '/staff/entry/add') {
      return [
        { label: 'Staff Portal', path: '/staff' },
        { label: 'Add', path: '/staff/add' },
        { label: 'Client & BD Management', path: '/staff/add' },
      ];
    }
    if (path === '/staff') {
      return [
        { label: 'Staff Portal', path: '/staff' },
        { label: 'Home Dashboard', path: '/staff' },
      ];
    }
    return [{ label: 'Portal', path }];
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 sm:px-6 bg-white border-b border-slate-200 shadow-sm">
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <button
          type="button"
          onClick={onToggleMobileMenu}
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.label + idx}>
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                <span className={isLast ? 'font-semibold text-slate-800' : 'hover:text-slate-700'}>
                  {crumb.label}
                </span>
              </React.Fragment>
            );
          })}
        </nav>
      </div>

      {/* User profile & actions */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 border border-amber-300 flex items-center justify-center font-semibold text-xs shadow-sm">
            <User className="w-4 h-4" />
          </div>
          <div className="hidden md:flex flex-col text-left">
            <span className="text-xs font-semibold text-slate-800 leading-tight">
              {user?.name || 'Staff User'}
            </span>
            <span className="text-xs text-amber-700 font-medium">
              {user?.role === 'STAFF' ? 'Staff Operations' : user?.role || 'User'}
            </span>
          </div>
        </div>

        {/* Logout button */}
        <button
          type="button"
          onClick={handleLogout}
          title="Sign out"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-slate-200 hover:border-rose-200 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};

