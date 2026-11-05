import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './components/AppShell.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import TodayPage from './features/today/TodayPage.jsx';
import TeamPage from './features/team/TeamPage.jsx';
import RequisitionsPage from './features/requisitions/RequisitionsPage.jsx';
import RequisitionDetail from './features/requisitions/RequisitionDetail.jsx';
import RequisitionWizard from './features/requisitions/RequisitionWizard.jsx';
import CandidatesPage from './features/candidates/CandidatesPage.jsx';
import AddCandidatePage from './features/candidates/AddCandidatePage.jsx';
import CandidateDetail from './features/candidates/CandidateDetail.jsx';
import SettingsPage from './features/settings/SettingsPage.jsx';
import BoardPage from './features/board/BoardPage.jsx';
import ProbationPage from './features/probation/ProbationPage.jsx';
import ReportsPage from './features/reports/ReportsPage.jsx';
import { CareersPage, RoleApplyPage, StatusPage } from './features/public/PublicPages.jsx';
import { RequirePermission } from './components/RequirePermission.jsx';
import { EmptyState } from './components/ui.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Public: no sign-in. Careers, applying, and the candidate's private status page. */}
      <Route path="/careers" element={<CareersPage />} />
      <Route path="/careers/:id" element={<RoleApplyPage />} />
      <Route path="/status/:token" element={<StatusPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<TodayPage />} />
        <Route path="board" element={<RequirePermission action="candidate.read"><BoardPage /></RequirePermission>} />
        <Route path="candidates" element={<RequirePermission action="candidate.read"><CandidatesPage /></RequirePermission>} />
        <Route path="candidates/new" element={<RequirePermission action="candidate.write"><AddCandidatePage /></RequirePermission>} />
        <Route path="candidates/:id" element={<RequirePermission action="candidate.read"><CandidateDetail /></RequirePermission>} />
        <Route path="probation" element={<RequirePermission action="probation.read"><ProbationPage /></RequirePermission>} />
        <Route path="reports" element={<RequirePermission action="reports.read"><ReportsPage /></RequirePermission>} />
        <Route path="requisitions" element={<RequirePermission action="requisition.read"><RequisitionsPage /></RequirePermission>} />
        <Route path="requisitions/new" element={<RequirePermission action="requisition.write"><RequisitionWizard /></RequirePermission>} />
        <Route path="requisitions/:id" element={<RequirePermission action="requisition.read"><RequisitionDetail /></RequirePermission>} />
        <Route path="requisitions/:id/edit" element={<RequirePermission action="requisition.write"><RequisitionWizard /></RequirePermission>} />
        <Route path="settings" element={<RequirePermission action="settings.read"><SettingsPage /></RequirePermission>} />
        <Route path="team" element={<RequirePermission action="users.manage"><TeamPage /></RequirePermission>} />
        <Route path="*" element={<EmptyState title="We could not find that page"><a href="/">Go to Today</a></EmptyState>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
