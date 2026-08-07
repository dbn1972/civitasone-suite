import { useState } from 'react';
import { Button, Input, Checkbox, Badge } from './ui';
import { Mail, Download, Plus, Settings, Check, X } from 'lucide-react';

export function ComponentLibraryShowcase() {
  const [checked, setChecked] = useState(false);
  const [inputValue, setInputValue] = useState('');

  return (
    <div className="size-full min-h-screen bg-surface-canvas p-8 overflow-auto">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-16">
          <h1 className="text-display mb-4">Component Library</h1>
          <h2 className="text-h2 text-text-secondary mb-2">CivitasOne Suite UI Kit</h2>
          <p className="text-base text-text-muted">
            Production-ready components built with design tokens
          </p>
        </div>

        {/* ATOMS Section */}
        <Section title="Atoms" subtitle="Foundational building blocks">
          {/* Button Component */}
          <ComponentGroup title="Button" description="All button variants, sizes, and states">
            <div className="space-y-8">
              {/* Variants */}
              <StateGroup title="Variants">
                <div className="flex flex-wrap gap-4">
                  <Button variant="primary">Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="tertiary">Tertiary</Button>
                  <Button variant="danger">Danger</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="link">Link</Button>
                </div>
              </StateGroup>

              {/* Sizes */}
              <StateGroup title="Sizes">
                <div className="flex flex-wrap items-center gap-4">
                  <Button size="sm">Small</Button>
                  <Button size="md">Medium</Button>
                  <Button size="lg">Large</Button>
                </div>
              </StateGroup>

              {/* With Icons */}
              <StateGroup title="With Icons">
                <div className="flex flex-wrap gap-4">
                  <Button leadingIcon={<Plus />}>Create New</Button>
                  <Button trailingIcon={<Download />}>Download</Button>
                  <Button iconOnly><Settings /></Button>
                  <Button variant="secondary" size="sm" leadingIcon={<Mail />}>Email</Button>
                </div>
              </StateGroup>

              {/* States */}
              <StateGroup title="States">
                <div className="flex flex-wrap gap-4">
                  <Button>Default</Button>
                  <Button loading>Loading</Button>
                  <Button disabled>Disabled</Button>
                </div>
              </StateGroup>

              {/* Dark Mode */}
              <StateGroup title="Dark Mode">
                <div className="dark p-6 rounded-lg bg-surface-canvas">
                  <div className="flex flex-wrap gap-4">
                    <Button variant="primary">Primary</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="tertiary">Tertiary</Button>
                    <Button variant="danger">Danger</Button>
                    <Button variant="ghost">Ghost</Button>
                  </div>
                </div>
              </StateGroup>
            </div>
          </ComponentGroup>

          {/* Input Component */}
          <ComponentGroup title="Input" description="Text input with states and helper text">
            <div className="space-y-8 max-w-md">
              <StateGroup title="Default">
                <Input
                  id="input-default"
                  placeholder="Enter your email"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              </StateGroup>

              <StateGroup title="With Helper Text">
                <Input
                  id="input-helper"
                  placeholder="Enter your email"
                  helperText="We'll never share your email with anyone."
                />
              </StateGroup>

              <StateGroup title="Error State">
                <Input
                  id="input-error"
                  placeholder="Enter your email"
                  error
                  helperText="This email is already in use."
                />
              </StateGroup>

              <StateGroup title="Disabled">
                <Input
                  id="input-disabled"
                  placeholder="Disabled input"
                  disabled
                  value="Cannot edit this"
                />
              </StateGroup>

              <StateGroup title="Types">
                <div className="space-y-4">
                  <Input id="input-text" type="text" placeholder="Text input" />
                  <Input id="input-email" type="email" placeholder="Email input" />
                  <Input id="input-password" type="password" placeholder="Password input" />
                  <Input id="input-number" type="number" placeholder="Number input" />
                  <Input id="input-search" type="search" placeholder="Search input" />
                </div>
              </StateGroup>

              <StateGroup title="Dark Mode">
                <div className="dark p-6 rounded-lg bg-surface-canvas">
                  <div className="space-y-4">
                    <Input id="input-dark-default" placeholder="Default" />
                    <Input id="input-dark-error" placeholder="Error" error helperText="Error message" />
                  </div>
                </div>
              </StateGroup>
            </div>
          </ComponentGroup>

          {/* Checkbox Component */}
          <ComponentGroup title="Checkbox" description="Checkbox with label and indeterminate state">
            <div className="space-y-8">
              <StateGroup title="States">
                <div className="space-y-4">
                  <Checkbox label="Unchecked" />
                  <Checkbox label="Checked" checked onChange={() => {}} />
                  <Checkbox label="Indeterminate" indeterminate />
                  <Checkbox label="Disabled" disabled />
                  <Checkbox label="Disabled Checked" checked disabled />
                </div>
              </StateGroup>

              <StateGroup title="Interactive">
                <Checkbox
                  label="I agree to the terms and conditions"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
              </StateGroup>

              <StateGroup title="Dark Mode">
                <div className="dark p-6 rounded-lg bg-surface-canvas">
                  <div className="space-y-4">
                    <Checkbox label="Unchecked" />
                    <Checkbox label="Checked" checked onChange={() => {}} />
                    <Checkbox label="Indeterminate" indeterminate />
                  </div>
                </div>
              </StateGroup>
            </div>
          </ComponentGroup>

          {/* Badge Component */}
          <ComponentGroup title="Badge" description="Intent-based badges for status and labels">
            <div className="space-y-8">
              <StateGroup title="Intent Variants">
                <div className="flex flex-wrap gap-3">
                  <Badge intent="success">Success</Badge>
                  <Badge intent="warning">Warning</Badge>
                  <Badge intent="danger">Danger</Badge>
                  <Badge intent="info">Info</Badge>
                  <Badge intent="primary">Primary</Badge>
                  <Badge intent="neutral">Neutral</Badge>
                </div>
              </StateGroup>

              <StateGroup title="Sizes">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge size="sm">Small Badge</Badge>
                  <Badge size="md">Medium Badge</Badge>
                </div>
              </StateGroup>

              <StateGroup title="Use Cases">
                <div className="flex flex-wrap gap-3">
                  <Badge intent="success">Active</Badge>
                  <Badge intent="warning">Pending</Badge>
                  <Badge intent="danger">Rejected</Badge>
                  <Badge intent="info">New</Badge>
                  <Badge intent="primary">Featured</Badge>
                  <Badge intent="neutral" size="sm">Draft</Badge>
                </div>
              </StateGroup>

              <StateGroup title="Dark Mode">
                <div className="dark p-6 rounded-lg bg-surface-canvas">
                  <div className="flex flex-wrap gap-3">
                    <Badge intent="success">Success</Badge>
                    <Badge intent="warning">Warning</Badge>
                    <Badge intent="danger">Danger</Badge>
                    <Badge intent="info">Info</Badge>
                    <Badge intent="primary">Primary</Badge>
                    <Badge intent="neutral">Neutral</Badge>
                  </div>
                </div>
              </StateGroup>
            </div>
          </ComponentGroup>
        </Section>

        {/* Accessibility Features */}
        <Section title="Accessibility Features" subtitle="WCAG 2.2 AA Compliant">
          <div className="grid md:grid-cols-2 gap-6">
            <FeatureCard
              icon={<Check className="size-6 text-intent-success" />}
              title="Focus Rings"
              description="All interactive components show visible focus indicators using shadow-focus token"
            />
            <FeatureCard
              icon={<Check className="size-6 text-intent-success" />}
              title="Keyboard Navigation"
              description="Full keyboard support with logical tab order and escape handling"
            />
            <FeatureCard
              icon={<Check className="size-6 text-intent-success" />}
              title="ARIA Labels"
              description="Proper ARIA attributes for screen readers and assistive technologies"
            />
            <FeatureCard
              icon={<Check className="size-6 text-intent-success" />}
              title="Color Contrast"
              description="All color combinations meet WCAG 2.2 AA contrast requirements (4.5:1 for text)"
            />
          </div>
        </Section>

        {/* Design Principles */}
        <Section title="Design Principles">
          <div className="grid md:grid-cols-3 gap-6">
            <PrincipleCard
              number="1"
              title="Token-Based"
              description="All styles use design tokens for consistency and themability"
            />
            <PrincipleCard
              number="2"
              title="Dark Mode First"
              description="Every component works seamlessly in both light and dark themes"
            />
            <PrincipleCard
              number="3"
              title="Accessible by Default"
              description="Built with WCAG 2.2 AA compliance as a non-negotiable requirement"
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-20">
      <div className="mb-8">
        <h2 className="text-h2 mb-2">{title}</h2>
        {subtitle && <p className="text-base text-text-muted">{subtitle}</p>}
      </div>
      <div className="space-y-12">
        {children}
      </div>
    </div>
  );
}

function ComponentGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="border-l-4 border-intent-primary pl-8">
      <div className="mb-6">
        <h3 className="text-h3 mb-2">{title}</h3>
        <p className="text-body-sm text-text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

function StateGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <code className="text-caption font-mono text-text-muted block mb-3">{title}</code>
      {children}
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-surface-raised border-2 border-border-subtle rounded-lg p-6 hover:border-intent-primary transition-colors">
      <div className="mb-3">{icon}</div>
      <h4 className="text-h4 mb-2">{title}</h4>
      <p className="text-body-sm text-text-muted">{description}</p>
    </div>
  );
}

function PrincipleCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="text-center">
      <div className="size-16 bg-intent-primary text-white rounded-full flex items-center justify-center text-h2 font-bold mx-auto mb-4">
        {number}
      </div>
      <h4 className="text-h4 mb-2">{title}</h4>
      <p className="text-body-sm text-text-muted">{description}</p>
    </div>
  );
}
