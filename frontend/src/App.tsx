import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { BauhausLayout } from './layouts/BauhausLayout';
import { Dashboard } from './pages/Dashboard';
import { CredentialsPage } from './pages/CredentialsPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Toaster } from 'sonner';

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" theme="light" />
      <Routes>
        <Route path="/" element={<BauhausLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="credentials" element={<CredentialsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
