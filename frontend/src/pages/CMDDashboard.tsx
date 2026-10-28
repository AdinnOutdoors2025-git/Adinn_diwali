import { Logo } from '../components/Logo';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ShieldCheck, LogOut, Clock } from 'lucide-react';

export const CMDDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { info } = useToast();

  const handleLogout = () => {
    logout();
    info('Logged out from CMD Portal');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Top Bar */}
      <header className="h-16 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="h-10 w-24 sm:w-32 flex items-center justify-center">
            <Logo onDark className="h-full w-full" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-wide">ADINN EXECUTIVE CMD PORTAL</span>
            <span className="text-xs text-amber-400 block font-mono">DIWALI SWEET DISTRIBUTION</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{user?.name} (CMD)</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-medium transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-6 sm:p-12 flex flex-col justify-center">
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold mb-4">
            <Clock className="w-3.5 h-3.5" />
            CMD Dashboard &bull; Phase 2 in Progress
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Welcome, Managing Director
          </h1>

          <p className="mt-3 text-slate-300 text-sm leading-relaxed max-w-2xl">
            You are securely authenticated as <span className="text-amber-300 font-semibold">{user?.email}</span> with executive CMD privileges.
          </p>

          <div className="mt-6 p-4 rounded-xl bg-slate-900/60 border border-slate-700/60 text-xs text-slate-400 space-y-2">
            <div className="font-semibold text-slate-200">Upcoming Executive Features:</div>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Comprehensive distribution review across all client types.</li>
              <li>Consolidated sweet box procurement & VIP client dispatch sign-off.</li>
              <li>Real-time vendor distribution expenditure and courier status audits.</li>
            </ul>
          </div>

          <p className="mt-6 text-xs text-slate-500">
            Staff data entry operations are currently active in the Staff Portal.
          </p>
        </div>
      </main>
    </div>
  );
};

