import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { InstallerShell, InstallerStep } from '../components/InstallerShell';
import { Card, Button, Input, FormField, Badge } from '../components/ui';
import {
  Server,
  Database,
  Shield,
  UserPlus,
  Play,
  Activity,
  Gauge,
  FileDown,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Cloud,
  HardDrive,
  Eye,
  EyeOff,
} from 'lucide-react';

const STEPS: InstallerStep[] = [
  { id: 1, label: 'Deployment Mode', status: 'complete' },
  { id: 2, label: 'Architecture Sizing', status: 'complete' },
  { id: 3, label: 'Adapter Selection', status: 'complete' },
  { id: 4, label: 'Environment Validation', status: 'complete' },
  { id: 5, label: 'Secrets & Security', status: 'complete' },
  { id: 6, label: 'Initial Admin', status: 'active' },
  { id: 7, label: 'Service Bootstrap', status: 'pending' },
  { id: 8, label: 'Health Verification', status: 'pending' },
  { id: 9, label: 'Readiness Score', status: 'pending' },
  { id: 10, label: 'Go-Live Handoff', status: 'pending' },
];

export function InstallerWizard() {
  const [currentStep, setCurrentStep] = useState(6);
  const [steps, setSteps] = useState(STEPS);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    adminEmail: '',
    adminName: '',
    adminPassword: '',
    confirmPassword: '',
  });

  const handleNext = () => {
    if (currentStep < 10) {
      // Mark current as complete, next as active
      setSteps((prev) =>
        prev.map((step) => {
          if (step.id === currentStep) return { ...step, status: 'complete' };
          if (step.id === currentStep + 1) return { ...step, status: 'active' };
          return step;
        })
      );
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setSteps((prev) =>
        prev.map((step) => {
          if (step.id === currentStep) return { ...step, status: 'pending' };
          if (step.id === currentStep - 1) return { ...step, status: 'active' };
          return step;
        })
      );
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <InstallerShell steps={steps} currentStep={currentStep}>
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          {currentStep === 1 && <Stage1DeploymentMode key="stage1" onNext={handleNext} />}
          {currentStep === 2 && <Stage2ArchitectureSizing key="stage2" onNext={handleNext} onBack={handleBack} />}
          {currentStep === 3 && <Stage3AdapterSelection key="stage3" onNext={handleNext} onBack={handleBack} />}
          {currentStep === 4 && <Stage4EnvironmentValidation key="stage4" onNext={handleNext} onBack={handleBack} />}
          {currentStep === 5 && <Stage5Secrets key="stage5" onNext={handleNext} onBack={handleBack} />}
          {currentStep === 6 && (
            <Stage6InitialAdmin
              key="stage6"
              formData={formData}
              setFormData={setFormData}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 7 && <Stage7ServiceBootstrap key="stage7" onNext={handleNext} onBack={handleBack} />}
          {currentStep === 8 && <Stage8HealthVerification key="stage8" onNext={handleNext} onBack={handleBack} />}
          {currentStep === 9 && <Stage9ReadinessScore key="stage9" onNext={handleNext} onBack={handleBack} />}
          {currentStep === 10 && <Stage10GoLive key="stage10" onBack={handleBack} />}
        </AnimatePresence>
      </div>
    </InstallerShell>
  );
}

// Stage Components
function StageContainer({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="mb-8">
        <div className="flex items-start gap-4 mb-4">
          <div className="size-12 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center text-white flex-shrink-0">
            {icon}
          </div>
          <div>
            <h2 className="text-h2 mb-2">{title}</h2>
            <p className="text-base text-text-secondary">{description}</p>
          </div>
        </div>
      </div>
      {children}
    </motion.div>
  );
}

function Stage1DeploymentMode({ onNext }: { onNext: () => void }) {
  const [selected, setSelected] = useState<string>('aws');

  return (
    <StageContainer
      icon={<Cloud className="size-6" />}
      title="Deployment Mode"
      description="Select how you want to deploy CivitasOne Suite"
    >
      <Card>
        <div className="space-y-4">
          <DeploymentOption
            id="aws"
            title="AWS Managed"
            description="Fully managed deployment on AWS with auto-scaling and high availability"
            selected={selected === 'aws'}
            onSelect={() => setSelected('aws')}
            recommended
          />
          <DeploymentOption
            id="k8s"
            title="On-Premises Kubernetes"
            description="Self-managed Kubernetes cluster for full control and compliance"
            selected={selected === 'k8s'}
            onSelect={() => setSelected('k8s')}
          />
          <DeploymentOption
            id="vms"
            title="On-Premises VMs"
            description="Traditional VM-based deployment for legacy infrastructure"
            selected={selected === 'vms'}
            onSelect={() => setSelected('vms')}
          />
        </div>
      </Card>

      <StageActions onNext={onNext} />
    </StageContainer>
  );
}

function Stage2ArchitectureSizing({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [selected, setSelected] = useState<string>('medium');

  return (
    <StageContainer
      icon={<Server className="size-6" />}
      title="Architecture Sizing"
      description="Choose the right infrastructure size for your organization"
    >
      <Card>
        <div className="grid md:grid-cols-2 gap-4">
          <SizingCard
            id="small"
            title="Small"
            description="Up to 100 users"
            specs={['2 vCPUs', '8 GB RAM', '100 GB Storage']}
            selected={selected === 'small'}
            onSelect={() => setSelected('small')}
          />
          <SizingCard
            id="medium"
            title="Medium"
            description="100-500 users"
            specs={['4 vCPUs', '16 GB RAM', '500 GB Storage']}
            selected={selected === 'medium'}
            onSelect={() => setSelected('medium')}
            recommended
          />
          <SizingCard
            id="enterprise"
            title="Enterprise"
            description="500-5000 users"
            specs={['8 vCPUs', '32 GB RAM', '2 TB Storage']}
            selected={selected === 'enterprise'}
            onSelect={() => setSelected('enterprise')}
          />
          <SizingCard
            id="ha"
            title="High Availability"
            description="5000+ users"
            specs={['16 vCPUs', '64 GB RAM', '10 TB Storage', 'Multi-region']}
            selected={selected === 'ha'}
            onSelect={() => setSelected('ha')}
          />
        </div>
      </Card>

      <StageActions onNext={onNext} onBack={onBack} />
    </StageContainer>
  );
}

function Stage3AdapterSelection({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <StageContainer
      icon={<Database className="size-6" />}
      title="Adapter Selection"
      description="Configure database, storage, cache, and other infrastructure adapters"
    >
      <div className="space-y-6">
        <Card>
          <h3 className="text-h4 mb-4">Database</h3>
          <div className="space-y-3">
            <AdapterOption label="PostgreSQL 15.x" selected badge="Recommended" />
            <AdapterOption label="MySQL 8.0" />
          </div>
        </Card>

        <Card>
          <h3 className="text-h4 mb-4">Object Storage</h3>
          <div className="space-y-3">
            <AdapterOption label="Amazon S3" selected />
            <AdapterOption label="MinIO (On-premises)" />
            <AdapterOption label="Azure Blob Storage" />
          </div>
        </Card>

        <Card>
          <h3 className="text-h4 mb-4">Cache & Queue</h3>
          <div className="space-y-3">
            <AdapterOption label="Redis 7.x" selected badge="Recommended" />
            <AdapterOption label="Memcached" />
          </div>
        </Card>
      </div>

      <StageActions onNext={onNext} onBack={onBack} />
    </StageContainer>
  );
}

function Stage4EnvironmentValidation({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);

  const checks = [
    { name: 'Database connectivity', status: tested ? 'pass' : 'pending' },
    { name: 'Object storage access', status: tested ? 'pass' : 'pending' },
    { name: 'Redis connection', status: tested ? 'pass' : 'pending' },
    { name: 'Network latency', status: tested ? 'pass' : 'pending' },
    { name: 'TLS certificates', status: tested ? 'pass' : 'pending' },
  ];

  const handleTest = () => {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      setTested(true);
    }, 3000);
  };

  return (
    <StageContainer
      icon={<Activity className="size-6" />}
      title="Environment Validation"
      description="Run connectivity tests for every adapter and verify infrastructure"
    >
      <Card>
        <div className="space-y-4">
          {checks.map((check, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
              <span className="text-base text-text-primary">{check.name}</span>
              {testing && (
                <Loader2 className="size-5 text-intent-info animate-spin" />
              )}
              {!testing && check.status === 'pass' && (
                <CheckCircle2 className="size-5 text-intent-success" />
              )}
              {!testing && check.status === 'pending' && (
                <div className="size-5 rounded-full border-2 border-border-default" />
              )}
            </div>
          ))}

          {!tested && (
            <Button
              onClick={handleTest}
              loading={testing}
              className="w-full"
            >
              {testing ? 'Running Tests...' : 'Run Connectivity Tests'}
            </Button>
          )}
        </div>
      </Card>

      <StageActions onNext={onNext} onBack={onBack} nextDisabled={!tested} />
    </StageContainer>
  );
}

function Stage5Secrets({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <StageContainer
      icon={<Shield className="size-6" />}
      title="Secrets & Security Baseline"
      description="Configure credentials, TLS certificates, and password policies"
    >
      <Card>
        <div className="space-y-6">
          <FormField label="Database Connection String" htmlFor="db-conn" required>
            <Input id="db-conn" type="password" placeholder="postgresql://user:pass@host:5432/db" />
          </FormField>

          <FormField label="S3 Access Key" htmlFor="s3-key" required>
            <Input id="s3-key" type="password" placeholder="AKIA..." />
          </FormField>

          <FormField label="S3 Secret Key" htmlFor="s3-secret" required>
            <Input id="s3-secret" type="password" placeholder="Enter secret key" />
          </FormField>

          <FormField label="Redis Connection String" htmlFor="redis-conn" required>
            <Input id="redis-conn" type="password" placeholder="redis://host:6379" />
          </FormField>

          <div className="pt-4 border-t border-border-subtle">
            <h4 className="text-h4 mb-4">Password Policy</h4>
            <div className="space-y-3 text-body-sm text-text-secondary">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-intent-success" />
                Minimum 12 characters
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-intent-success" />
                Require uppercase and lowercase
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-intent-success" />
                Require numbers and special characters
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-intent-success" />
                Password expiry: 90 days
              </div>
            </div>
          </div>
        </div>
      </Card>

      <StageActions onNext={onNext} onBack={onBack} />
    </StageContainer>
  );
}

function Stage6InitialAdmin({
  formData,
  setFormData,
  showPassword,
  setShowPassword,
  onNext,
  onBack,
}: {
  formData: any;
  setFormData: any;
  showPassword: boolean;
  setShowPassword: any;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <StageContainer
      icon={<UserPlus className="size-6" />}
      title="Initial Admin Creation"
      description="Create the super-admin account with mandatory MFA enrollment"
    >
      <Card>
        <div className="space-y-6">
          <FormField label="Admin Name" htmlFor="admin-name" required>
            <Input
              id="admin-name"
              value={formData.adminName}
              onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
              placeholder="John Doe"
            />
          </FormField>

          <FormField label="Admin Email" htmlFor="admin-email" required>
            <Input
              id="admin-email"
              type="email"
              value={formData.adminEmail}
              onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
              placeholder="admin@gov.in"
            />
          </FormField>

          <FormField
            label="Password"
            htmlFor="admin-password"
            helperText="Minimum 12 characters with uppercase, lowercase, numbers, and special characters"
            required
          >
            <div className="relative">
              <Input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                value={formData.adminPassword}
                onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                placeholder="••••••••••••"
                className="pe-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </FormField>

          <FormField label="Confirm Password" htmlFor="confirm-password" required>
            <Input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              placeholder="••••••••••••"
            />
          </FormField>

          <div className="p-4 bg-intent-warning-bg border border-intent-warning-border rounded-lg">
            <div className="flex gap-3">
              <AlertCircle className="size-5 text-intent-warning flex-shrink-0 mt-0.5" />
              <div className="text-body-sm text-text-primary">
                <strong>MFA Required:</strong> After account creation, you will be prompted to set up
                two-factor authentication using an authenticator app.
              </div>
            </div>
          </div>
        </div>
      </Card>

      <StageActions onNext={onNext} onBack={onBack} />
    </StageContainer>
  );
}

function Stage7ServiceBootstrap({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [bootstrapping, setBootstrapping] = useState(false);
  const [completed, setCompleted] = useState(false);

  const services = [
    { name: 'auth-service', status: completed ? 'running' : 'pending' },
    { name: 'api-gateway', status: completed ? 'running' : 'pending' },
    { name: 'platform-service', status: completed ? 'running' : 'pending' },
    { name: 'finance-service', status: completed ? 'running' : 'pending' },
    { name: 'hrms-service', status: completed ? 'running' : 'pending' },
  ];

  const handleBootstrap = () => {
    setBootstrapping(true);
    setTimeout(() => {
      setBootstrapping(false);
      setCompleted(true);
    }, 5000);
  };

  return (
    <StageContainer
      icon={<Play className="size-6" />}
      title="Service Bootstrap"
      description="Initialize all CivitasOne services and verify they're running"
    >
      <Card>
        <div className="space-y-4">
          <div
            className="p-4 bg-surface-sunken rounded-lg font-mono text-body-sm max-h-64 overflow-y-auto"
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {!bootstrapping && !completed && (
              <div className="text-text-muted">Click "Start Bootstrap" to begin...</div>
            )}
            {bootstrapping && (
              <div className="space-y-1 text-text-primary">
                <div>[INFO] Starting bootstrap process...</div>
                <div>[INFO] Initializing database schema...</div>
                <div>[INFO] Creating service accounts...</div>
                <div>[INFO] Starting auth-service... ✓</div>
                <div>[INFO] Starting api-gateway... ✓</div>
                <div className="animate-pulse">[INFO] Starting platform-service...</div>
              </div>
            )}
            {completed && (
              <div className="space-y-1 text-intent-success">
                <div>[SUCCESS] All services started successfully</div>
                <div>[SUCCESS] Health checks passed</div>
                <div>[SUCCESS] Ready for verification</div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {services.map((service, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                <span className="text-base font-mono text-text-primary">{service.name}</span>
                <Badge intent={service.status === 'running' ? 'success' : 'neutral'}>
                  {service.status}
                </Badge>
              </div>
            ))}
          </div>

          {!completed && (
            <Button onClick={handleBootstrap} loading={bootstrapping} className="w-full">
              {bootstrapping ? 'Bootstrapping Services...' : 'Start Bootstrap'}
            </Button>
          )}
        </div>
      </Card>

      <StageActions onNext={onNext} onBack={onBack} nextDisabled={!completed} />
    </StageContainer>
  );
}

function Stage8HealthVerification({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const healthChecks = [
    { service: 'auth-service', endpoint: '/health', status: 'healthy', replicas: '3/3' },
    { service: 'api-gateway', endpoint: '/health', status: 'healthy', replicas: '2/2' },
    { service: 'platform-service', endpoint: '/health', status: 'healthy', replicas: '2/2' },
    { service: 'finance-service', endpoint: '/health', status: 'healthy', replicas: '1/1' },
    { service: 'hrms-service', endpoint: '/health', status: 'healthy', replicas: '1/1' },
  ];

  return (
    <StageContainer
      icon={<Activity className="size-6" />}
      title="Health Verification"
      description="Verify all services are healthy and replica counts are met"
    >
      <Card>
        <div className="space-y-4">
          {healthChecks.map((check, index) => (
            <div key={index} className="p-4 bg-surface-sunken rounded-lg">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-base font-medium text-text-primary">{check.service}</div>
                  <div className="text-body-sm font-mono text-text-muted">{check.endpoint}</div>
                </div>
                <Badge intent="success">Healthy</Badge>
              </div>
              <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                <span>Replicas:</span>
                <span className="font-mono text-intent-success">{check.replicas}</span>
              </div>
            </div>
          ))}

          <div className="p-4 bg-intent-success-bg border border-intent-success-border rounded-lg">
            <div className="flex gap-3">
              <CheckCircle2 className="size-5 text-intent-success flex-shrink-0 mt-0.5" />
              <div className="text-body-sm text-text-primary">
                <strong>All health checks passed!</strong> All services are running and ready.
              </div>
            </div>
          </div>
        </div>
      </Card>

      <StageActions onNext={onNext} onBack={onBack} />
    </StageContainer>
  );
}

function Stage9ReadinessScore({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const score = 92;
  const categories = [
    { name: 'Security', score: 95, weight: 25, contribution: 23.75 },
    { name: 'Reliability', score: 90, weight: 20, contribution: 18 },
    { name: 'Observability', score: 88, weight: 15, contribution: 13.2 },
    { name: 'Backup/DR', score: 95, weight: 15, contribution: 14.25 },
    { name: 'Performance', score: 90, weight: 10, contribution: 9 },
    { name: 'Documentation', score: 92, weight: 10, contribution: 9.2 },
    { name: 'Operational Hygiene', score: 88, weight: 5, contribution: 4.4 },
  ];

  return (
    <StageContainer
      icon={<Gauge className="size-6" />}
      title="Enterprise Readiness Score"
      description="Verify your installation meets production readiness standards"
    >
      <Card>
        <div className="space-y-8">
          {/* Readiness Gauge */}
          <div className="text-center">
            <div className="relative inline-flex items-center justify-center">
              <svg className="size-64" viewBox="0 0 200 200">
                <circle
                  cx="100"
                  cy="100"
                  r="80"
                  fill="none"
                  stroke="var(--surface-sunken)"
                  strokeWidth="20"
                />
                <circle
                  cx="100"
                  cy="100"
                  r="80"
                  fill="none"
                  stroke="var(--intent-success)"
                  strokeWidth="20"
                  strokeDasharray={`${(score / 100) * 502.4} 502.4`}
                  strokeLinecap="round"
                  transform="rotate(-90 100 100)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div
                  className="text-6xl font-bold text-intent-success"
                  role="meter"
                  aria-valuenow={score}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Readiness score: ${score} out of 100`}
                >
                  {score}
                </div>
                <div className="text-body-sm text-text-muted">/ 100</div>
              </div>
            </div>
            <Badge intent="success" className="mt-4">
              Production Ready (≥85)
            </Badge>
          </div>

          {/* Category Breakdown */}
          <div>
            <h3 className="text-h4 mb-4">Score Breakdown</h3>
            <div className="space-y-3">
              {categories.map((category, index) => (
                <div key={index} className="p-4 bg-surface-sunken rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-base font-medium text-text-primary">{category.name}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-body-sm text-text-muted">Weight: {category.weight}%</span>
                      <Badge intent={category.score >= 85 ? 'success' : 'warning'}>
                        {category.score}%
                      </Badge>
                    </div>
                  </div>
                  <div className="h-2 bg-surface-canvas rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        category.score >= 85 ? 'bg-intent-success' : 'bg-intent-warning'
                      }`}
                      style={{ width: `${category.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <StageActions onNext={onNext} onBack={onBack} />
    </StageContainer>
  );
}

function Stage10GoLive({ onBack }: { onBack: () => void }) {
  return (
    <StageContainer
      icon={<FileDown className="size-6" />}
      title="Go-Live Handoff"
      description="Download installation report, runbook, and credentials for production deployment"
    >
      <Card>
        <div className="space-y-6">
          <div className="p-6 bg-intent-success-bg border-2 border-intent-success-border rounded-lg text-center">
            <CheckCircle2 className="size-16 text-intent-success mx-auto mb-4" />
            <h3 className="text-h3 text-intent-success mb-2">Installation Complete!</h3>
            <p className="text-base text-text-primary">
              Your CivitasOne Suite installation is ready for production use.
            </p>
          </div>

          <div>
            <h3 className="text-h4 mb-4">Download Installation Assets</h3>
            <div className="space-y-3">
              <DownloadButton
                title="Installation Report"
                description="Complete summary of your installation configuration"
                filename="civitasone-install-report.pdf"
              />
              <DownloadButton
                title="Operations Runbook"
                description="Day-to-day operations guide and troubleshooting"
                filename="civitasone-runbook.pdf"
              />
              <DownloadButton
                title="Credentials Envelope"
                description="Encrypted file containing all service credentials"
                filename="civitasone-credentials.enc"
              />
              <DownloadButton
                title="Backup Configuration"
                description="Automated backup settings and schedule"
                filename="backup-config.yaml"
              />
            </div>
          </div>

          <div className="pt-6 border-t border-border-subtle">
            <h3 className="text-h4 mb-4">Next Steps</h3>
            <ol className="space-y-3 list-decimal list-inside text-base text-text-secondary">
              <li>Review the installation report for configuration details</li>
              <li>Secure the credentials envelope in your password manager</li>
              <li>Schedule regular backups according to the backup configuration</li>
              <li>Complete user onboarding and role assignments</li>
              <li>Configure tenant branding and customization</li>
            </ol>
          </div>
        </div>
      </Card>

      <div className="flex justify-between mt-8">
        <Button variant="secondary" onClick={onBack} leadingIcon={<ChevronLeft />}>
          Back
        </Button>
        <Button leadingIcon={<ChevronRight />} onClick={() => (window.location.href = '/tenant-admin')}>
          Go to Admin Dashboard
        </Button>
      </div>
    </StageContainer>
  );
}

// Helper Components
function DeploymentOption({
  id,
  title,
  description,
  selected,
  onSelect,
  recommended = false,
}: {
  id: string;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full p-4 rounded-lg border-2 text-start transition-all ${
        selected
          ? 'border-intent-primary bg-intent-primary-bg'
          : 'border-border-default hover:border-intent-primary'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-base font-medium text-text-primary">{title}</h4>
            {recommended && <Badge intent="primary" size="sm">Recommended</Badge>}
          </div>
          <p className="text-body-sm text-text-secondary">{description}</p>
        </div>
        <div
          className={`size-5 rounded-full border-2 flex-shrink-0 ms-3 mt-1 ${
            selected ? 'border-intent-primary bg-intent-primary' : 'border-border-default'
          }`}
        >
          {selected && <div className="size-full rounded-full border-2 border-white" />}
        </div>
      </div>
    </button>
  );
}

function SizingCard({
  id,
  title,
  description,
  specs,
  selected,
  onSelect,
  recommended = false,
}: {
  id: string;
  title: string;
  description: string;
  specs: string[];
  selected: boolean;
  onSelect: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={`p-6 rounded-lg border-2 text-start transition-all ${
        selected
          ? 'border-intent-primary bg-intent-primary-bg'
          : 'border-border-default hover:border-intent-primary'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-h4 mb-1">{title}</h4>
          {recommended && <Badge intent="primary" size="sm">Recommended</Badge>}
        </div>
        <div
          className={`size-5 rounded-full border-2 flex-shrink-0 ${
            selected ? 'border-intent-primary bg-intent-primary' : 'border-border-default'
          }`}
        >
          {selected && <div className="size-full rounded-full border-2 border-white" />}
        </div>
      </div>
      <p className="text-body-sm text-text-secondary mb-4">{description}</p>
      <ul className="space-y-2 text-body-sm text-text-primary">
        {specs.map((spec, index) => (
          <li key={index} className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-intent-success flex-shrink-0" />
            {spec}
          </li>
        ))}
      </ul>
    </button>
  );
}

function AdapterOption({ label, selected = false, badge }: { label: string; selected?: boolean; badge?: string }) {
  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border-2 ${
        selected ? 'border-intent-primary bg-intent-primary-bg' : 'border-border-subtle'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-base text-text-primary">{label}</span>
        {badge && <Badge intent="primary" size="sm">{badge}</Badge>}
      </div>
      <div
        className={`size-5 rounded-full border-2 ${
          selected ? 'border-intent-primary bg-intent-primary' : 'border-border-default'
        }`}
      >
        {selected && <div className="size-full rounded-full border-2 border-white" />}
      </div>
    </div>
  );
}

function DownloadButton({ title, description, filename }: { title: string; description: string; filename: string }) {
  return (
    <button className="w-full p-4 bg-surface-sunken hover:bg-surface-canvas border-2 border-border-subtle hover:border-intent-primary rounded-lg transition-all text-start group">
      <div className="flex items-start gap-4">
        <div className="size-10 bg-intent-primary-bg text-intent-primary rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-intent-primary group-hover:text-white transition-colors">
          <FileDown className="size-5" />
        </div>
        <div className="flex-1">
          <div className="text-base font-medium text-text-primary mb-1">{title}</div>
          <div className="text-body-sm text-text-secondary">{description}</div>
          <div className="text-caption font-mono text-text-muted mt-1">{filename}</div>
        </div>
      </div>
    </button>
  );
}

function StageActions({
  onNext,
  onBack,
  nextDisabled = false,
}: {
  onNext?: () => void;
  onBack?: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex justify-between mt-8">
      {onBack ? (
        <Button variant="secondary" onClick={onBack} leadingIcon={<ChevronLeft />}>
          Back
        </Button>
      ) : (
        <div />
      )}
      {onNext && (
        <Button onClick={onNext} disabled={nextDisabled} trailingIcon={<ChevronRight />}>
          Save and Continue
        </Button>
      )}
    </div>
  );
}
