import { Logo } from '../components/Logo';
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserPlus, Sparkles, ArrowRight, Layers, Gift } from 'lucide-react';

export const StaffHome: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-amber-950 p-6 sm:p-8 text-white shadow-lg border border-slate-700/50">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold mb-3 border border-amber-500/30">
            <Sparkles className="w-3.5 h-3.5" />
            Sweet Distribution Operations Portal
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome, {user?.name || 'Staff Member'}!
          </h1>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed">
            Record sweet distribution for each festival and manage client/vendor registrations across all client types and Requestees.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/staff/entry"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs sm:text-sm shadow-md transition-colors"
            >
              <Gift className="w-4 h-4" />
              <span>Sweet Distribution Entry</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/staff/add"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs sm:text-sm border border-slate-700 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Clients & Requestees</span>
            </Link>
          </div>
        </div>

        {/* Festive Watermark */}
        <div className="absolute right-4 bottom-2 w-40 sm:w-64 opacity-90 pointer-events-none select-none">
          <Logo onDark className="w-full h-auto" />
        </div>
      </div>

      {/* Quick Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Entry Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mb-4">
            <Layers className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Entry &rarr; Sweet Distribution</h2>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Track and record sweet distribution per client by year, type, and Requestee. Enforces one box per year across all types.
          </p>
          <div className="mt-5">
            <Link
              to="/staff/entry"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700"
            >
              Open Distribution Entry <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Add Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-4">
            <UserPlus className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Add &rarr; Client & Requestee Management</h2>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Register Requestees, manage client and vendor details, and upload Excel rosters without creating distribution logs.
          </p>
          <div className="mt-5">
            <Link
              to="/staff/add"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              Open Registration Module <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
