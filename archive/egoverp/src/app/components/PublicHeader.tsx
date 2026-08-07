import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from './ui';
import { Menu, X } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { motion, AnimatePresence } from 'motion/react';

export function PublicHeader() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface-raised/80 border-b border-border-subtle backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/')}>
            <div className="size-9 bg-gradient-to-br from-brand-primary to-brand-accent rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow">
              <span className="text-white font-bold text-base">C1</span>
            </div>
            <span className="font-bold text-text-primary text-h3">CivitasOne Suite</span>
          </div>

          <nav className="hidden lg:flex items-center gap-8">
            <a href="/features" onClick={(e) => { e.preventDefault(); navigate('/features'); }} className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Features</a>
            <a href="/pricing" onClick={(e) => { e.preventDefault(); navigate('/pricing'); }} className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Pricing</a>
            <a href="/resources/documentation" onClick={(e) => { e.preventDefault(); navigate('/resources/documentation'); }} className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">Docs</a>
            <a href="/company/about" onClick={(e) => { e.preventDefault(); navigate('/company/about'); }} className="text-body-sm font-medium text-text-secondary hover:text-text-primary transition-colors">About</a>
          </nav>

          <div className="hidden lg:flex items-center gap-3">
            <ThemeToggle />
            <Button variant="secondary" size="sm" onClick={() => navigate('/company/contact')}>Talk to Sales</Button>
            <Button variant="primary" size="sm" onClick={() => navigate('/auth/login')}>Sign In</Button>
          </div>

          <div className="flex lg:hidden items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="lg:hidden border-t border-border-subtle bg-surface-raised">
            <nav className="px-4 py-4 space-y-3">
              <a href="/features" onClick={(e) => { e.preventDefault(); navigate('/features'); setMobileMenuOpen(false); }} className="block py-3 text-body-sm font-medium hover:text-text-primary transition-colors">Features</a>
              <a href="/pricing" onClick={(e) => { e.preventDefault(); navigate('/pricing'); setMobileMenuOpen(false); }} className="block py-3 text-body-sm font-medium hover:text-text-primary transition-colors">Pricing</a>
              <a href="/resources/documentation" onClick={(e) => { e.preventDefault(); navigate('/resources/documentation'); setMobileMenuOpen(false); }} className="block py-3 text-body-sm font-medium hover:text-text-primary transition-colors">Docs</a>
              <a href="/company/about" onClick={(e) => { e.preventDefault(); navigate('/company/about'); setMobileMenuOpen(false); }} className="block py-3 text-body-sm font-medium hover:text-text-primary transition-colors">About</a>
              <Button variant="primary" size="md" className="w-full" onClick={() => navigate('/auth/login')}>Sign In</Button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
