import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Check, X, Lock, AlertCircle } from 'lucide-react';

export interface InstallerStep {
  id: number;
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error' | 'blocked';
}

interface InstallerShellProps {
  steps: InstallerStep[];
  currentStep: number;
  children: ReactNode;
}

export function InstallerShell({ steps, currentStep, children }: InstallerShellProps) {
  return (
    <div className="size-full min-h-screen bg-surface-canvas flex flex-col lg:flex-row">
      {/* Left Rail - Stepper (Desktop) */}
      <aside className="hidden lg:flex lg:w-80 bg-surface-raised border-r-2 border-border-subtle flex-col">
        <div className="p-6 border-b-2 border-border-subtle">
          <div className="flex items-center gap-3 mb-2">
            <div className="size-10 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">C1</span>
            </div>
            <div>
              <h1 className="text-h4 font-semibold">CivitasOne Suite</h1>
              <p className="text-caption text-text-muted">Installation Wizard</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4" role="navigation" aria-label="Installation stages">
          <ol className="space-y-2">
            {steps.map((step) => (
              <StepItem
                key={step.id}
                step={step}
                isActive={step.id === currentStep}
                isCurrent={step.id === currentStep}
              />
            ))}
          </ol>
        </nav>

        <div className="p-4 border-t-2 border-border-subtle">
          <div className="text-caption text-text-muted">
            Step {currentStep} of {steps.length}
          </div>
          <div className="mt-2 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-brand-primary to-brand-accent"
              initial={{ width: 0 }}
              animate={{ width: `${(currentStep / steps.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </aside>

      {/* Mobile Stepper - Top Accordion */}
      <div className="lg:hidden bg-surface-raised border-b-2 border-border-subtle">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center">
                <span className="text-white text-body-sm font-bold">C1</span>
              </div>
              <span className="text-body-sm font-semibold">Installation Wizard</span>
            </div>
            <span className="text-caption text-text-muted">
              {currentStep}/{steps.length}
            </span>
          </div>
          <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-brand-primary to-brand-accent"
              initial={{ width: 0 }}
              animate={{ width: `${(currentStep / steps.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

function StepItem({
  step,
  isActive,
  isCurrent,
}: {
  step: InstallerStep;
  isActive: boolean;
  isCurrent: boolean;
}) {
  const statusConfig = {
    pending: {
      icon: <div className="size-6 rounded-full border-2 border-border-default bg-surface-canvas" />,
      color: 'text-text-muted',
      bgColor: 'bg-transparent',
    },
    active: {
      icon: (
        <div className="size-6 rounded-full bg-intent-primary flex items-center justify-center">
          <div className="size-2 rounded-full bg-white animate-pulse" />
        </div>
      ),
      color: 'text-intent-primary',
      bgColor: 'bg-intent-primary-bg',
    },
    complete: {
      icon: (
        <div className="size-6 rounded-full bg-intent-success flex items-center justify-center">
          <Check className="size-4 text-white" strokeWidth={3} />
        </div>
      ),
      color: 'text-intent-success',
      bgColor: 'bg-transparent',
    },
    error: {
      icon: (
        <div className="size-6 rounded-full bg-intent-danger flex items-center justify-center">
          <X className="size-4 text-white" strokeWidth={3} />
        </div>
      ),
      color: 'text-intent-danger',
      bgColor: 'bg-intent-danger-bg',
    },
    blocked: {
      icon: (
        <div className="size-6 rounded-full bg-intent-warning flex items-center justify-center">
          <Lock className="size-3 text-white" />
        </div>
      ),
      color: 'text-intent-warning',
      bgColor: 'bg-intent-warning-bg',
    },
  };

  const config = statusConfig[step.status];

  return (
    <li
      className={`flex items-start gap-3 p-3 rounded-lg transition-all ${config.bgColor} ${
        isActive ? 'shadow-sm' : ''
      }`}
      aria-current={isCurrent ? 'step' : undefined}
    >
      <div className="flex-shrink-0 mt-0.5">{config.icon}</div>
      <div className="flex-1 min-w-0">
        <div className={`text-body-sm font-medium ${config.color}`}>
          {step.id}. {step.label}
        </div>
      </div>
    </li>
  );
}
