import { useNavigate } from 'react-router';
import { Button } from './ui';
import { ThemeToggle } from './ThemeToggle';

interface PageHeaderProps {
  showAuth?: boolean;
  additionalButtons?: React.ReactNode;
}

export function PageHeader({ showAuth = true, additionalButtons }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <>
      {/* Skip to main content link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:start-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-intent-primary focus:text-white focus:rounded-lg focus:shadow-lg"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 bg-surface-raised border-b-2 border-border-subtle backdrop-blur-sm bg-opacity-95" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => navigate('/')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate('/');
                }
              }}
              aria-label="Go to home page"
            >
              <div className="size-8 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">C1</span>
              </div>
              <span className="font-bold text-text-primary text-h4">CivitasOne Suite</span>
            </div>

            <div className="flex items-center gap-3">
              <ThemeToggle />
              {additionalButtons}
              {showAuth && (
                <Button variant="primary" size="md" onClick={() => navigate('/auth/login')}>
                  Sign in
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
