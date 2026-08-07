import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { ThemeProvider } from './contexts/ThemeContext';
import { motion } from 'motion/react';
import { ScrollToTop } from './components/ScrollToTop';

// Auth components
import { LoginScreen } from './components/LoginScreen';
import { MFAScreen } from './components/MFAScreen';
import { Dashboard as AuthDashboard } from './components/Dashboard';

// Design System Showcases
import { DesignTokensShowcase } from './components/DesignTokensShowcase';
import { ComponentLibraryShowcase } from './components/ComponentLibraryShowcase';
import { MoleculesShowcase } from './pages/MoleculesShowcase';
import { OrganismsShowcase } from './pages/OrganismsShowcase';
import { TemplatesShowcase } from './pages/TemplatesShowcase';

// Platform Pages
import { InstallerWizard } from './pages/InstallerWizard';
import { TenantAdminHome } from './pages/TenantAdminHome';

// App Layout
import { AppShell } from './components/AppShell';

// App Pages
import { AppDashboard } from './pages/AppDashboard';
import { FinanceInvoices } from './pages/finance/FinanceInvoices';
import { FinancePayments } from './pages/finance/FinancePayments';
import { FinanceReports } from './pages/finance/FinanceReports';
import { ChartOfAccounts } from './pages/finance/ChartOfAccounts';
import { JournalEntry } from './pages/finance/JournalEntry';
import { HRMSEmployees } from './pages/hrms/HRMSEmployees';
import { HRMSAttendance } from './pages/hrms/HRMSAttendance';
import { HRMSPayroll } from './pages/hrms/HRMSPayroll';
import { LeaveApply } from './pages/hrms/LeaveApply';
import { MyLeaves } from './pages/hrms/MyLeaves';
import { LeaveApprovals } from './pages/hrms/LeaveApprovals';
import { ProcurementOrders } from './pages/procurement/ProcurementOrders';
import { ProcurementVendors } from './pages/procurement/ProcurementVendors';
import { ProcurementApprovals } from './pages/procurement/ProcurementApprovals';
import { PurchaseOrderList } from './pages/procurement/PurchaseOrderList';
import { PurchaseOrderCreate } from './pages/procurement/PurchaseOrderCreate';
import { PurchaseOrderView } from './pages/procurement/PurchaseOrderView';
import { DealPipeline } from './pages/crm/DealPipeline';
import { CRMContacts } from './pages/crm/CRMContacts';
import { CRMActivities } from './pages/crm/CRMActivities';
import { TicketDetail } from './pages/helpdesk/TicketDetail';
import { HelpdeskTickets } from './pages/helpdesk/HelpdeskTickets';
import { HelpdeskReports } from './pages/helpdesk/HelpdeskReports';
import { ReportCenter } from './pages/reports/ReportCenter';
import { ReportView } from './pages/reports/ReportView';
import { ReportBuilder } from './pages/reports/ReportBuilder';
import { ApprovalInbox } from './pages/ApprovalInbox';
import { LandingPage } from './pages/LandingPage';
import { StatusPage } from './pages/StatusPage';
import { InventoryManagement } from './pages/InventoryManagement';
import { AssetManagement } from './pages/AssetManagement';
import { ProjectManagement } from './pages/ProjectManagement';

// Marketing Pages
import { Features } from './pages/marketing/Features';
import { Integrations } from './pages/marketing/Integrations';
import { Pricing } from './pages/marketing/Pricing';
import { Changelog } from './pages/marketing/Changelog';
import { Roadmap } from './pages/marketing/Roadmap';

// Editions Pages
import { SmallOffice } from './pages/editions/SmallOffice';
import { PSU } from './pages/editions/PSU';
import { Government } from './pages/editions/Government';
import { CompareEditions } from './pages/editions/CompareEditions';

// Resources Pages
import { Documentation } from './pages/resources/Documentation';
import { APIReference } from './pages/resources/APIReference';

// Company Pages
import { About } from './pages/company/About';
import { Contact } from './pages/company/Contact';

// Legal Pages
import { Terms } from './pages/legal/Terms';
import { Privacy } from './pages/legal/Privacy';
import { CookiePolicy } from './pages/legal/CookiePolicy';
import { Accessibility } from './pages/legal/Accessibility';
import { Trademarks } from './pages/legal/Trademarks';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          {/* Default Route - Landing Page */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/status" element={<StatusPage />} />

          {/* Marketing Pages */}
          <Route path="/features" element={<Features />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/roadmap" element={<Roadmap />} />

          {/* Editions Pages */}
          <Route path="/editions/small-office" element={<SmallOffice />} />
          <Route path="/editions/psu" element={<PSU />} />
          <Route path="/editions/government" element={<Government />} />
          <Route path="/editions/compare" element={<CompareEditions />} />

          {/* Resources Pages */}
          <Route path="/resources/documentation" element={<Documentation />} />
          <Route path="/resources/api" element={<APIReference />} />

          {/* Company Pages */}
          <Route path="/company/about" element={<About />} />
          <Route path="/company/contact" element={<Contact />} />

          {/* Legal Pages */}
          <Route path="/legal/terms" element={<Terms />} />
          <Route path="/legal/privacy" element={<Privacy />} />
          <Route path="/legal/cookie-policy" element={<CookiePolicy />} />
          <Route path="/legal/accessibility" element={<Accessibility />} />
          <Route path="/legal/trademarks" element={<Trademarks />} />

          {/* Design System Routes (No AppShell) */}
          <Route path="/design-tokens" element={<DesignTokensShowcase />} />
          <Route path="/components" element={<ComponentLibraryShowcase />} />
          <Route path="/molecules" element={<MoleculesShowcase />} />
          <Route path="/organisms" element={<OrganismsShowcase />} />
          <Route path="/templates" element={<TemplatesShowcase />} />

          {/* Platform Routes (No AppShell) */}
          <Route path="/install" element={<InstallerWizard />} />

          {/* Auth Routes (No AppShell) */}
          <Route path="/auth/login" element={<LoginScreen />} />
          <Route path="/auth/login/error-invalid" element={<LoginScreen prefilledError="invalid" />} />
          <Route path="/auth/login/error-locked" element={<LoginScreen prefilledError="locked" />} />
          <Route path="/auth/mfa" element={<MFAScreen />} />
          <Route path="/auth/mfa/error-invalid" element={<MFAScreen prefilledError="invalid" />} />
          <Route path="/auth/mfa/error-locked" element={<MFAScreen prefilledError="locked" />} />
          <Route path="/dashboard" element={<AuthDashboard />} />

          {/* Tenant Admin Route (With AppShell) */}
          <Route path="/tenant-admin" element={
            <AppShell>
              <TenantAdminHome />
            </AppShell>
          } />

          {/* App Routes (With AppShell) */}
          <Route path="/app/*" element={
            <AppShell>
              <Routes>
                <Route path="dashboard" element={<AppDashboard />} />
                <Route path="approvals" element={<ApprovalInbox />} />

                {/* Finance Module */}
                <Route path="finance/invoices" element={<FinanceInvoices />} />
                <Route path="finance/chart-of-accounts" element={<ChartOfAccounts />} />
                <Route path="finance/journals/new" element={<JournalEntry mode="create" />} />
                <Route path="finance/journals/:id" element={<JournalEntry mode="view" />} />
                <Route path="finance/payments" element={<FinancePayments />} />
                <Route path="finance/reports" element={<FinanceReports />} />

                {/* HRMS Module */}
                <Route path="hrms/employees" element={<HRMSEmployees />} />
                <Route path="hrms/leave/apply" element={<LeaveApply />} />
                <Route path="hrms/leave/my" element={<MyLeaves />} />
                <Route path="hrms/leave/approvals" element={<LeaveApprovals />} />
                <Route path="hrms/attendance" element={<HRMSAttendance />} />
                <Route path="hrms/payroll" element={<HRMSPayroll />} />

                {/* Procurement Module */}
                <Route path="procurement/orders" element={<PurchaseOrderList />} />
                <Route path="procurement/orders/new" element={<PurchaseOrderCreate />} />
                <Route path="procurement/orders/:id" element={<PurchaseOrderView />} />
                <Route path="procurement/vendors" element={<ProcurementVendors />} />
                <Route path="procurement/approvals" element={<ProcurementApprovals />} />

                {/* CRM Module */}
                <Route path="crm/pipeline" element={<DealPipeline />} />
                <Route path="crm/contacts" element={<CRMContacts />} />
                <Route path="crm/activities" element={<CRMActivities />} />
                <Route path="crm/*" element={<ComingSoonPage module="CRM" />} />

                {/* Helpdesk Module */}
                <Route path="helpdesk/tickets" element={<HelpdeskTickets />} />
                <Route path="helpdesk/tickets/:id" element={<TicketDetail />} />
                <Route path="helpdesk/reports" element={<HelpdeskReports />} />
                <Route path="helpdesk/*" element={<ComingSoonPage module="Helpdesk" />} />

                {/* Reports Module */}
                <Route path="reports" element={<ReportCenter />} />
                <Route path="reports/builder" element={<ReportBuilder />} />
                <Route path="reports/:id" element={<ReportView />} />

                {/* Other Modules */}
                <Route path="inventory" element={<InventoryManagement />} />
                <Route path="assets" element={<AssetManagement />} />
                <Route path="projects" element={<ProjectManagement />} />
              </Routes>
            </AppShell>
          } />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

function ComingSoonPage({ module }: { module: string }) {
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-2xl mx-auto text-center py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="size-24 bg-gradient-to-br from-brand-primary to-brand-accent rounded-2xl mx-auto flex items-center justify-center">
            <span className="text-4xl">🚧</span>
          </div>
          <h1 className="text-h1">Coming Soon</h1>
          <p className="text-base text-text-secondary">
            The <strong>{module}</strong> module is under development.
          </p>
          <p className="text-body-sm text-text-muted">
            Check back soon for updates!
          </p>
        </motion.div>
      </div>
    </div>
  );
}
