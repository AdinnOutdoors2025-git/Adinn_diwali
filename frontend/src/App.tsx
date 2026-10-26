import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { StaffLayout } from './components/StaffLayout';
import { Login } from './pages/Login';
import { StaffHome } from './pages/StaffHome';
import { Entry } from './pages/Entry';
import { CMDDashboard } from './pages/CMDDashboard';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public Auth Route */}
            <Route path="/login" element={<Login />} />

            {/* CMD Portal Protected Route */}
            <Route
              path="/cmd"
              element={
                <ProtectedRoute allowedRoles={['CMD']}>
                  <CMDDashboard />
                </ProtectedRoute>
              }
            />

            {/* Staff Dashboard Routes */}
            <Route
              path="/staff"
              element={
                <ProtectedRoute allowedRoles={['STAFF']}>
                  <StaffLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<StaffHome />} />
              <Route path="entry" element={<Entry />} />
              <Route path="reports" element={<Navigate to="/staff/entry" replace />} />
              <Route path="add" element={<Navigate to="/staff/entry#manage-clients-bds" replace />} />
              {/* Backward compatibility fallback */}
              <Route path="entry/add" element={<Navigate to="/staff/entry#manage-clients-bds" replace />} />
            </Route>

            {/* Fallbacks & Redirects */}
            <Route path="/" element={<Navigate to="/staff" replace />} />
            <Route path="*" element={<Navigate to="/staff" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;
