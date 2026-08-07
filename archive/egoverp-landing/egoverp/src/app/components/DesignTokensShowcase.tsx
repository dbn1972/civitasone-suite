import { motion } from 'motion/react';

export function DesignTokensShowcase() {
  return (
    <div className="size-full min-h-screen bg-surface-canvas p-8 overflow-auto">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-16">
          <h1 className="text-display mb-4" style={{ lineHeight: 'var(--text-display-lh)' }}>
            CivitasOne Suite
          </h1>
          <h2 className="text-h2 text-text-secondary mb-2" style={{ lineHeight: 'var(--text-h2-lh)' }}>
            Design Tokens v0.1.0
          </h2>
          <p className="text-base text-text-muted" style={{ lineHeight: 'var(--text-base-lh)' }}>
            Foundation for the unified enterprise design system
          </p>
        </div>

        {/* 1. COLOR — SEMANTIC */}
        <Section title="Color — Semantic (Light + Dark)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Light Mode */}
            <div>
              <h4 className="text-h4 mb-4">Light Mode</h4>

              <ColorGroup title="Surface">
                <ColorSwatch name="surface-canvas" value="#ffffff" contrast="—" />
                <ColorSwatch name="surface-raised" value="#ffffff" contrast="—" />
                <ColorSwatch name="surface-sunken" value="#f8f9fa" contrast="—" />
              </ColorGroup>

              <ColorGroup title="Text">
                <ColorSwatch name="text-primary" value="#1a1a1a" contrast="14.5:1" />
                <ColorSwatch name="text-secondary" value="#525252" contrast="7.5:1" />
                <ColorSwatch name="text-muted" value="#a3a3a3" contrast="3.5:1" />
                <ColorSwatch name="text-inverse" value="#ffffff" contrast="—" />
              </ColorGroup>

              <ColorGroup title="Border">
                <ColorSwatch name="border-subtle" value="#e5e5e5" contrast="—" />
                <ColorSwatch name="border-default" value="#d4d4d4" contrast="—" />
                <ColorSwatch name="border-strong" value="#a3a3a3" contrast="—" />
              </ColorGroup>

              <ColorGroup title="Intent">
                <ColorSwatch name="intent-success" value="#16a34a" bg="#dcfce7" />
                <ColorSwatch name="intent-warning" value="#ea580c" bg="#ffedd5" />
                <ColorSwatch name="intent-danger" value="#dc2626" bg="#fee2e2" />
                <ColorSwatch name="intent-info" value="#0284c7" bg="#e0f2fe" />
                <ColorSwatch name="intent-primary" value="#4f46e5" bg="#eef2ff" />
              </ColorGroup>
            </div>

            {/* Dark Mode */}
            <div className="dark p-6 rounded-lg" style={{ backgroundColor: 'var(--surface-canvas)' }}>
              <h4 className="text-h4 mb-4" style={{ color: 'var(--text-primary)' }}>Dark Mode</h4>

              <ColorGroup title="Surface" dark>
                <ColorSwatch name="surface-canvas" value="#0a0a0a" dark />
                <ColorSwatch name="surface-raised" value="#171717" dark />
                <ColorSwatch name="surface-sunken" value="#000000" dark />
              </ColorGroup>

              <ColorGroup title="Text" dark>
                <ColorSwatch name="text-primary" value="#fafafa" contrast="16.2:1" dark />
                <ColorSwatch name="text-secondary" value="#d4d4d4" contrast="9.5:1" dark />
                <ColorSwatch name="text-muted" value="#737373" contrast="4.8:1" dark />
                <ColorSwatch name="text-inverse" value="#0a0a0a" dark />
              </ColorGroup>

              <ColorGroup title="Border" dark>
                <ColorSwatch name="border-subtle" value="#262626" dark />
                <ColorSwatch name="border-default" value="#404040" dark />
                <ColorSwatch name="border-strong" value="#737373" dark />
              </ColorGroup>

              <ColorGroup title="Intent" dark>
                <ColorSwatch name="intent-success" value="#22c55e" bg="#14532d" dark />
                <ColorSwatch name="intent-warning" value="#f97316" bg="#431407" dark />
                <ColorSwatch name="intent-danger" value="#ef4444" bg="#450a0a" dark />
                <ColorSwatch name="intent-info" value="#06b6d4" bg="#083344" dark />
                <ColorSwatch name="intent-primary" value="#6366f1" bg="#1e1b4b" dark />
              </ColorGroup>
            </div>
          </div>
        </Section>

        {/* 2. COLOR — BRAND */}
        <Section title="Color — Brand (Tenant Overridable)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <BrandSwatch name="brand-primary" value="#4f46e5" label="Primary Brand" />
            <BrandSwatch name="brand-secondary" value="#7c3aed" label="Secondary Brand" />
            <BrandSwatch name="brand-accent" value="#ec4899" label="Accent Brand" />
          </div>
          <p className="text-body-sm text-text-muted mt-6">
            These tokens can be overridden at runtime per tenant configuration
          </p>
        </Section>

        {/* 3. TYPOGRAPHY */}
        <Section title="Typography">
          <div className="space-y-6">
            <div>
              <div className="flex items-baseline gap-4 mb-2">
                <code className="text-caption font-mono text-text-muted">font.sans</code>
                <span className="text-body-sm text-text-secondary">Inter</span>
              </div>
              <div className="flex items-baseline gap-4">
                <code className="text-caption font-mono text-text-muted">font.mono</code>
                <span className="text-body-sm text-text-secondary font-mono">JetBrains Mono</span>
              </div>
            </div>

            <div className="space-y-4 mt-8">
              <TypeSample token="display" size="40/48" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="h1" size="32/40" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="h2" size="24/32" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="h3" size="20/28" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="h4" size="18/24" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="base" size="16/24" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="body-sm" size="14/20" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="caption" size="12/16" text="CivitasOne Suite delivers governance at scale." />
              <TypeSample token="code" size="14/20" text="CivitasOne Suite delivers governance at scale." mono />
            </div>
          </div>
        </Section>

        {/* 4. SPACING */}
        <Section title="Spacing (4px Scale)">
          <div className="space-y-3">
            <SpacingBar token="space-1" value="4px" />
            <SpacingBar token="space-2" value="8px" />
            <SpacingBar token="space-3" value="12px" />
            <SpacingBar token="space-4" value="16px" />
            <SpacingBar token="space-5" value="20px" />
            <SpacingBar token="space-6" value="24px" />
            <SpacingBar token="space-8" value="32px" />
            <SpacingBar token="space-10" value="40px" />
            <SpacingBar token="space-12" value="48px" />
            <SpacingBar token="space-16" value="64px" />
          </div>
        </Section>

        {/* 5. RADIUS */}
        <Section title="Radius">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <RadiusCard token="radius-sm" value="4px" />
            <RadiusCard token="radius-md" value="8px" />
            <RadiusCard token="radius-lg" value="12px" />
            <RadiusCard token="radius-pill" value="9999px" />
          </div>
        </Section>

        {/* 6. SHADOW */}
        <Section title="Shadow (Elevation)">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <ShadowCard token="shadow-sm" label="Small" />
            <ShadowCard token="shadow-md" label="Medium" />
            <ShadowCard token="shadow-lg" label="Large" />
            <ShadowCard token="shadow-focus" label="Focus Ring" />
          </div>
        </Section>

        {/* 7. MOTION */}
        <Section title="Motion">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <MotionDemo duration="fast" ms="120ms" />
            <MotionDemo duration="base" ms="200ms" />
            <MotionDemo duration="slow" ms="320ms" />
          </div>
          <p className="text-body-sm text-text-muted mt-6">
            Easing: cubic-bezier(0.2, 0, 0, 1) — Standard Material Design easing
          </p>
        </Section>

        {/* 8. DENSITY */}
        <Section title="Density">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <DensityTable mode="comfortable" label="Comfortable (Default — Small Office)" />
            <DensityTable mode="compact" label="Compact (Govt/PSU Default)" />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-16" style={{ paddingBottom: 'var(--space-16)' }}>
      <h2 className="text-h2 mb-8" style={{ lineHeight: 'var(--text-h2-lh)' }}>{title}</h2>
      {children}
    </div>
  );
}

function ColorGroup({ title, children, dark = false }: { title: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="mb-6">
      <h5 className="text-body-sm font-semibold mb-3" style={{ color: dark ? 'var(--text-primary)' : undefined }}>
        {title}
      </h5>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}

function ColorSwatch({ name, value, contrast, bg, dark = false }: { name: string; value: string; contrast?: string; bg?: string; dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="size-12 rounded border-2"
        style={{
          backgroundColor: bg || value,
          borderColor: dark ? 'var(--border-default)' : '#e5e5e5'
        }}
      />
      <div className="flex-1">
        <code className="text-caption font-mono block" style={{ color: dark ? 'var(--text-secondary)' : undefined }}>
          {name}
        </code>
        <div className="flex gap-3 text-caption" style={{ color: dark ? 'var(--text-muted)' : '#a3a3a3' }}>
          <span>{value}</span>
          {contrast && <span>{contrast}</span>}
        </div>
      </div>
    </div>
  );
}

function BrandSwatch({ name, value, label }: { name: string; value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="size-24 rounded-lg mx-auto mb-3" style={{ backgroundColor: value }} />
      <code className="text-caption font-mono block text-text-muted">{name}</code>
      <span className="text-body-sm text-text-secondary">{label}</span>
      <div className="text-caption text-text-muted mt-1">{value}</div>
    </div>
  );
}

function TypeSample({ token, size, text, mono = false }: { token: string; size: string; text: string; mono?: boolean }) {
  return (
    <div className="border-l-2 border-intent-primary pl-4">
      <div className="flex items-baseline gap-4 mb-2">
        <code className="text-caption font-mono text-text-muted min-w-[80px]">text.{token}</code>
        <span className="text-caption text-text-muted">{size}px</span>
      </div>
      <p
        className={mono ? 'font-mono' : ''}
        style={{
          fontSize: `var(--text-${token})`,
          lineHeight: `var(--text-${token}-lh)`
        }}
      >
        {text}
      </p>
    </div>
  );
}

function SpacingBar({ token, value }: { token: string; value: string }) {
  return (
    <div className="flex items-center gap-4">
      <code className="text-caption font-mono text-text-muted min-w-[80px]">{token}</code>
      <span className="text-caption text-text-muted min-w-[60px]">{value}</span>
      <div
        className="h-8 bg-intent-primary rounded"
        style={{ width: `var(--${token})` }}
      />
    </div>
  );
}

function RadiusCard({ token, value }: { token: string; value: string }) {
  return (
    <div className="text-center">
      <div
        className="size-24 bg-intent-primary mx-auto mb-3"
        style={{ borderRadius: `var(--${token})` }}
      />
      <code className="text-caption font-mono block text-text-muted">{token}</code>
      <span className="text-caption text-text-secondary">{value}</span>
    </div>
  );
}

function ShadowCard({ token, label }: { token: string; label: string }) {
  return (
    <div className="text-center">
      <div
        className="size-24 bg-surface-raised mx-auto mb-3 rounded-lg"
        style={{ boxShadow: `var(--${token})` }}
      />
      <code className="text-caption font-mono block text-text-muted">{token}</code>
      <span className="text-caption text-text-secondary">{label}</span>
    </div>
  );
}

function MotionDemo({ duration, ms }: { duration: string; ms: string }) {
  return (
    <div className="text-center">
      <div className="h-32 bg-surface-sunken rounded-lg mb-3 flex items-center justify-center overflow-hidden">
        <motion.div
          animate={{ x: [0, 100, 0], opacity: [1, 0.5, 1] }}
          transition={{
            duration: duration === 'fast' ? 0.12 : duration === 'base' ? 0.2 : 0.32,
            repeat: Infinity,
            ease: [0.2, 0, 0, 1]
          }}
          className="size-12 bg-intent-primary rounded-lg"
        />
      </div>
      <code className="text-caption font-mono block text-text-muted">motion.{duration}</code>
      <span className="text-caption text-text-secondary">{ms}</span>
    </div>
  );
}

function DensityTable({ mode, label }: { mode: string; label: string }) {
  const padding = mode === 'comfortable' ? 'var(--density-comfortable)' : 'var(--density-compact)';

  return (
    <div>
      <h5 className="text-body-sm font-semibold mb-3">{label}</h5>
      <div className="border border-border-default rounded-lg overflow-hidden">
        <div className="bg-surface-sunken px-4 font-medium border-b border-border-default" style={{ padding }}>
          Name
        </div>
        {['Alice Kumar', 'Bob Smith', 'Carol Chen'].map((name, i) => (
          <div
            key={name}
            className={`px-4 ${i < 2 ? 'border-b border-border-subtle' : ''}`}
            style={{ padding }}
          >
            {name}
          </div>
        ))}
      </div>
      <p className="text-caption text-text-muted mt-2">
        Row padding: {mode === 'comfortable' ? '16px' : '8px'}
      </p>
    </div>
  );
}
