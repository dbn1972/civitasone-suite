import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useRef, useEffect } from 'react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const themes = [
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'dark' as const, label: 'Dark', icon: Moon },
    { value: 'system' as const, label: 'System', icon: Monitor },
  ];

  const currentThemeConfig = themes.find(t => t.value === theme) || themes[0];
  const Icon = currentThemeConfig.icon;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="size-10 rounded-lg flex items-center justify-center bg-surface-raised hover:bg-surface-sunken transition-colors border-2 border-border-subtle focus:outline-none focus:ring-2 focus:ring-intent-primary focus:ring-offset-2"
        aria-label="Toggle theme"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Icon className="size-5 text-text-primary" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute end-0 mt-2 w-40 bg-surface-raised border-2 border-border-subtle rounded-xl shadow-[var(--shadow-lg)] overflow-hidden z-50"
            role="menu"
            aria-orientation="vertical"
          >
            {themes.map((t) => {
              const ThemeIcon = t.icon;
              const isActive = theme === t.value;

              return (
                <button
                  key={t.value}
                  onClick={() => {
                    setTheme(t.value);
                    setIsOpen(false);
                  }}
                  className={`w-full px-4 py-3 flex items-center gap-3 transition-colors ${
                    isActive
                      ? 'bg-intent-primary text-white'
                      : 'hover:bg-surface-sunken text-text-primary'
                  }`}
                  role="menuitem"
                  aria-current={isActive ? 'true' : undefined}
                >
                  <ThemeIcon className="size-4" />
                  <span className="text-body-sm font-medium">{t.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="active-theme"
                      className="ms-auto size-2 rounded-full bg-white"
                    />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
