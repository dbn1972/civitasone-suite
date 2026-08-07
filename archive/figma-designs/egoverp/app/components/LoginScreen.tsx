import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, Eye, EyeOff, Building2, AlertCircle, Loader2 } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { Input, Button, Label } from './ui';

interface LoginScreenProps {
  showTenantInput?: boolean;
  ssoProviders?: string[];
  prefilledError?: 'invalid' | 'locked' | null;
}

export function LoginScreen({
  showTenantInput = false,
  ssoProviders = ['Keycloak OIDC', 'SAML'],
  prefilledError = null
}: LoginScreenProps) {
  const navigate = useNavigate();
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{type: 'invalid' | 'locked' | 'generic', message: string, correlationId?: string} | null>(
    prefilledError === 'invalid' ? {
      type: 'invalid',
      message: 'Invalid username or password. Please try again.',
      correlationId: 'ERR-' + Math.random().toString(36).substr(2, 9).toUpperCase()
    } : prefilledError === 'locked' ? {
      type: 'locked',
      message: 'Your account has been locked due to multiple failed login attempts. Please contact your administrator.',
    } : null
  );
  const [errors, setErrors] = useState<{ email?: string; password?: string; tenant?: string }>({});

  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const tenantInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Autofocus on mount
    if (showTenantInput && tenantInputRef.current) {
      tenantInputRef.current.focus();
    } else if (emailInputRef.current) {
      emailInputRef.current.focus();
    }
  }, [showTenantInput]);

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: { email?: string; password?: string; tenant?: string } = {};

    if (showTenantInput && !tenant) {
      newErrors.tenant = 'Tenant identifier is required';
    }

    if (!email) {
      newErrors.email = 'Email or username is required';
    } else if (!validateEmail(email) && !email.match(/^[a-zA-Z0-9_]+$/)) {
      newErrors.email = 'Please enter a valid email or username';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    setError(null);

    if (Object.keys(newErrors).length === 0) {
      setIsLoading(true);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));

      setIsLoading(false);

      // Simulate MFA required - navigate to MFA screen
      navigate('/auth/mfa');
    } else {
      // Focus on first error field
      if (newErrors.tenant && tenantInputRef.current) {
        tenantInputRef.current.focus();
      } else if (newErrors.email && emailInputRef.current) {
        emailInputRef.current.focus();
      } else if (newErrors.password && passwordInputRef.current) {
        passwordInputRef.current.focus();
      }
    }
  };

  const handleSSOLogin = (provider: string) => {
    setIsLoading(true);
    // Simulate SSO redirect
    setTimeout(() => {
      window.location.href = `/auth/sso/${provider.toLowerCase().replace(' ', '-')}`;
    }, 500);
  };

  const isFormValid = email.length > 0 && password.length > 0 && (!showTenantInput || tenant.length > 0);

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Card with Surface Raised */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 backdrop-blur-xl border border-white/10">
          {/* Brand Region */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="inline-flex items-center justify-center size-20 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl mb-4 shadow-lg"
            >
              <Building2 className="size-10 text-white" />
            </motion.div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
              CivitasOne Suite
            </h1>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-1">
              Sign in to your workspace
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Government Digital Platform
            </p>
          </div>

          {/* Error Banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                role="alert"
                aria-live="assertive"
                className={`rounded-lg p-4 ${
                  error.type === 'locked'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                }`}
              >
                <div className="flex gap-3">
                  <AlertCircle className={`size-5 mt-0.5 flex-shrink-0 ${
                    error.type === 'locked' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                  }`} />
                  <div className="flex-1">
                    <p className={`font-medium ${
                      error.type === 'locked' ? 'text-amber-900 dark:text-amber-200' : 'text-red-900 dark:text-red-200'
                    }`}>
                      {error.message}
                    </p>
                    {error.correlationId && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Correlation ID: {error.correlationId}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Login Form */}
          <form onSubmit={handleSubmit} aria-label="Sign in" className="space-y-5">
            {/* Tenant Identifier (conditional) */}
            {showTenantInput && (
              <div className="space-y-2">
                <Label htmlFor="tenant">
                  Tenant Identifier
                </Label>
                <div className="relative">
                  <Building2 className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-gray-400 pointer-events-none" />
                  <Input
                    ref={tenantInputRef}
                    id="tenant"
                    type="text"
                    value={tenant}
                    onChange={(e) => {
                      setTenant(e.target.value);
                      setErrors({ ...errors, tenant: undefined });
                    }}
                    placeholder="organization-id"
                    aria-invalid={!!errors.tenant}
                    aria-describedby={errors.tenant ? 'tenant-error' : undefined}
                    className="ps-11"
                  />
                </div>
                {errors.tenant && (
                  <p id="tenant-error" className="flex items-center gap-1 text-red-600 dark:text-red-400 text-sm mt-1">
                    <AlertCircle className="size-4" />
                    {errors.tenant}
                  </p>
                )}
              </div>
            )}

            {/* Email/Username Input */}
            <div className="space-y-2">
              <Label htmlFor="email">
                Email or Username
              </Label>
              <div className="relative">
                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-gray-400 pointer-events-none" />
                <Input
                  ref={emailInputRef}
                  id="email"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrors({ ...errors, email: undefined });
                  }}
                  placeholder="you@example.com"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  className="ps-11"
                />
              </div>
              {errors.email && (
                <p id="email-error" className="flex items-center gap-1 text-red-600 dark:text-red-400 text-sm mt-1">
                  <AlertCircle className="size-4" />
                  {errors.email}
                </p>
              )}
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <Label htmlFor="password">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute start-3 top-1/2 -translate-y-1/2 size-5 text-gray-400 pointer-events-none" />
                <Input
                  ref={passwordInputRef}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrors({ ...errors, password: undefined });
                  }}
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  className="ps-11 pe-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute end-1 top-1/2 -translate-y-1/2 size-8 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
              {errors.password && (
                <p id="password-error" className="flex items-center gap-1 text-red-600 dark:text-red-400 text-sm mt-1">
                  <AlertCircle className="size-4" />
                  {errors.password}
                </p>
              )}
            </div>

            {/* Forgot Password Link */}
            <div className="flex justify-end">
              <a
                href="/auth/forgot"
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1"
              >
                Forgot password?
              </a>
            </div>

            {/* Primary Submit Button */}
            <motion.div
              whileHover={isFormValid && !isLoading ? { scale: 1.01 } : {}}
              whileTap={isFormValid && !isLoading ? { scale: 0.99 } : {}}
            >
              <Button
                type="submit"
                disabled={!isFormValid || isLoading}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl"
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </motion.div>
          </form>

          {/* SSO Section */}
          {ssoProviders.length > 0 && (
            <>
              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                    or continue with
                  </span>
                </div>
              </div>

              {/* SSO Buttons */}
              <div className="space-y-3">
                {ssoProviders.map((provider) => (
                  <Button
                    key={provider}
                    onClick={() => handleSSOLogin(provider)}
                    disabled={isLoading}
                    variant="outline"
                    className="w-full"
                    size="lg"
                  >
                    <Lock className="size-5" />
                    {provider}
                  </Button>
                ))}
              </div>
            </>
          )}

          {/* Footer Link */}
          <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-6">
            Don't have an account?{' '}
            <a
              href="#contact"
              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1"
            >
              Contact your admin
            </a>
          </p>
        </div>
      </motion.div>
    </AuthShell>
  );
}
