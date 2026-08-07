import { useState } from 'react';
import { FormField, Input, Card, Tabs } from '../components/ui';
import { Search, Filter } from 'lucide-react';

export function MoleculesShowcase() {
  const [searchValue, setSearchValue] = useState('');

  return (
    <div className="size-full min-h-screen bg-surface-canvas p-8 overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="mb-12">
          <h1 className="text-display mb-4">Molecules</h1>
          <p className="text-base text-text-muted">
            Complex components composed of atoms
          </p>
        </div>

        {/* FormField */}
        <Section title="FormField">
          <Card>
            <div className="space-y-6 max-w-md">
              <FormField label="Email Address" htmlFor="email" required>
                <Input id="email" type="email" placeholder="you@example.com" />
              </FormField>

              <FormField
                label="Password"
                htmlFor="password"
                helperText="Must be at least 8 characters"
                required
              >
                <Input id="password" type="password" placeholder="••••••••" />
              </FormField>

              <FormField
                label="Username"
                htmlFor="username"
                error="This username is already taken"
              >
                <Input id="username" type="text" placeholder="johndoe" error />
              </FormField>
            </div>
          </Card>
        </Section>

        {/* SearchBar */}
        <Section title="SearchBar">
          <Card>
            <div className="max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-text-muted" />
                <Input
                  id="search"
                  type="search"
                  placeholder="Search..."
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </Card>
        </Section>

        {/* Tabs */}
        <Section title="Tabs">
          <Card>
            <Tabs
              tabs={[
                {
                  id: 'overview',
                  label: 'Overview',
                  content: (
                    <div className="p-6 bg-surface-sunken rounded-lg">
                      <h3 className="text-h3 mb-2">Overview Content</h3>
                      <p className="text-text-secondary">This is the overview tab content.</p>
                    </div>
                  ),
                },
                {
                  id: 'details',
                  label: 'Details',
                  badge: 3,
                  content: (
                    <div className="p-6 bg-surface-sunken rounded-lg">
                      <h3 className="text-h3 mb-2">Details Content</h3>
                      <p className="text-text-secondary">This is the details tab with 3 items.</p>
                    </div>
                  ),
                },
                {
                  id: 'settings',
                  label: 'Settings',
                  content: (
                    <div className="p-6 bg-surface-sunken rounded-lg">
                      <h3 className="text-h3 mb-2">Settings Content</h3>
                      <p className="text-text-secondary">This is the settings tab content.</p>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </Section>

        {/* Filter Bar */}
        <Section title="FilterBar">
          <Card>
            <div className="flex items-center gap-3 flex-wrap">
              <button className="flex items-center gap-2 px-3 py-2 bg-surface-sunken rounded-lg text-body-sm text-text-primary hover:bg-surface-canvas transition-colors border-2 border-border-subtle">
                <Filter className="size-4" />
                All Filters
              </button>
              <div className="flex items-center gap-2 flex-wrap">
                <FilterChip label="Status: Active" onRemove={() => {}} />
                <FilterChip label="Department: Finance" onRemove={() => {}} />
                <FilterChip label="Date: Last 30 days" onRemove={() => {}} />
              </div>
              <button className="text-body-sm text-intent-primary hover:underline ml-auto">
                Clear all
              </button>
            </div>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <h2 className="text-h2 mb-6">{title}</h2>
      {children}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-intent-primary-bg text-intent-primary rounded-full text-body-sm border border-intent-primary-border">
      {label}
      <button
        onClick={onRemove}
        className="size-4 rounded-full hover:bg-intent-primary hover:text-white transition-colors flex items-center justify-center"
      >
        ×
      </button>
    </div>
  );
}
