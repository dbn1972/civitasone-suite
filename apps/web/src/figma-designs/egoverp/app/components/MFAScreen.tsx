import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Building2, AlertCircle, Loader2, Shield, Key, Smartphone, FileText } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { Input, Button } from './ui';

interface MFAScreenProps {
  prefilledError?: 'invalid' | 'locked' | null;
}

type MFAMethod = 'totp' | 'webauthn' | 'recovery' | 'sms';

export function MFAScreen({ prefilledError = null }: MFAScreenProps) {
  const navigate = useNavigate();
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{type: 'invalid' | 'locked', message: string, attemptsLeft?: number} | null>(
    prefilledError === 'invalid' ? {
      type: 'invalid',
      message: 'Invalid code. Please try again.',
      attemptsLeft: 2
    } : prefilledError === 'locked' ? {
      type: 'locked',
      message: 'Too many failed attempts. Your account has been temporarily locked for 15 minutes.',
    } : null
  );
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [currentMethod, setCurrentMethod] = useState<MFAMethod>('totp');
  const [flashError, setFlashError] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Focus first input on mount
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    // Auto-submit when all 6 digits are filled
    if (otp.every(digit => digit !== '') && !isLoading) {
      handleVerify();
    }
  }, [otp]);

  const handleInputChange = (index: number, value: string) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError(null);
    setFlashError(false);

    // Auto-advance to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      // Move to previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();

    // Extract only digits
    const digits = pastedData.replace(/\D/g, '').slice(0, 6);

    if (digits.length === 6) {
      const newOtp = digits.split('');
      setOtp(newOtp);
      setError(null);
      setFlashError(false);
      // Focus last input
      inputRefs.current[5]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length !== 6) return;

    setIsLoading(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));

    setIsLoading(false);

    // Simulate success and redirect to dashboard
    navigate('/dashboard');
  };

  const handleMethodChange = (method: MFAMethod) => {
    setCurrentMethod(method);
    setShowMethodPicker(false);
    setOtp(['', '', '', '', '', '']);
    setError(null);
    setFlashError(false);

    if (method === 'totp') {
      inputRefs.current[0]?.focus();
    }
  };

  const isFormValid = otp.every(digit => digit !== '');

  const getMethodIcon = (method: MFAMethod) => {
    switch (method) {
      case 'totp': return <Smartphone className="size-5" />;
      case 'webauthn': return <Key className="size-5" />;
      case 'recovery': return <FileText className="size-5" />;
      case 'sms': return <Smartphone className="size-5" />;
    }
  };

  const getMethodLabel = (method: MFAMethod) => {
    switch (method) {
      case 'totp': return 'Authenticator app';
      case 'webauthn': return 'Security key';
      case 'recovery': return 'Recovery code';
      case 'sms': return 'SMS code';
    }
  };

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
              <Shield className="size-10 text-white" />
            </motion.div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
              CivitasOne Suite
            </h1>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
              Verify your identity
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {currentMethod === 'totp' && 'Enter the 6-digit code from your authenticator app'}
              {currentMethod === 'webauthn' && 'Insert your security key and follow the prompts'}
              {currentMethod === 'recovery' && 'Enter one of your recovery codes'}
              {currentMethod === 'sms' && 'Enter the code sent to your phone'}
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
                aria-atomic="true"
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
                    {error.attemptsLeft !== undefined && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1" aria-live="polite">
                        {error.attemptsLeft} {error.attemptsLeft === 1 ? 'attempt' : 'attempts'} remaining
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* OTP Input - Only show for TOTP method */}
          {currentMethod === 'totp' && (
            <div className="mb-6">
              <div className="flex gap-2 justify-center mb-6">
                {otp.map((digit, index) => (
                  <motion.input
                    key={index}
                    ref={(el) => (inputRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleInputChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={index === 0 ? handlePaste : undefined}
                    disabled={isLoading}
                    aria-label={`Digit ${index + 1} of 6`}
                    animate={flashError ? { x: [-10, 10, -10, 10, 0] } : {}}
                    transition={{ duration: 0.4 }}
                    className={`size-12 text-center text-xl font-semibold bg-gray-50 dark:bg-gray-800 border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent transition-all text-gray-900 dark:text-white ${
                      flashError
                        ? 'border-red-300 dark:border-red-700'
                        : 'border-gray-200 dark:border-gray-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                ))}
              </div>

              {/* Verify Button */}
              <motion.div
                whileHover={isFormValid && !isLoading ? { scale: 1.01 } : {}}
                whileTap={isFormValid && !isLoading ? { scale: 0.99 } : {}}
              >
                <Button
                  onClick={handleVerify}
                  disabled={!isFormValid || isLoading}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify'
                  )}
                </Button>
              </motion.div>
            </div>
          )}

          {/* WebAuthn Prompt */}
          {currentMethod === 'webauthn' && (
            <div className="mb-6">
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-6 text-center mb-4">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="inline-flex items-center justify-center size-16 bg-indigo-100 dark:bg-indigo-800 rounded-full mb-4"
                >
                  <Key className="size-8 text-indigo-600 dark:text-indigo-400" />
                </motion.div>
                <p className="text-indigo-900 dark:text-indigo-200 font-medium mb-2">
                  Insert your security key
                </p>
                <p className="text-sm text-indigo-700 dark:text-indigo-300">
                  Follow the prompts on your security key device
                </p>
              </div>

              <Button
                onClick={() => {/* Trigger WebAuthn */}}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl"
                size="lg"
              >
                Use Security Key
              </Button>
            </div>
          )}

          {/* Recovery Code Input */}
          {currentMethod === 'recovery' && (
            <div className="mb-6 space-y-4">
              <Input
                type="text"
                placeholder="Enter recovery code"
              />
              <Button
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl"
                size="lg"
              >
                Verify Recovery Code
              </Button>
            </div>
          )}

          {/* Alternative Methods */}
          <div className="space-y-3">
            <Button
              onClick={() => setShowMethodPicker(true)}
              variant="link"
              className="w-full text-sm"
            >
              Use a different method
            </Button>
            <a
              href="/auth/recovery"
              className="block w-full text-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1 py-1"
            >
              I lost my device
            </a>
          </div>
        </div>

        {/* Back to Login */}
        <div className="text-center mt-4">
          <Button
            onClick={() => navigate('/auth/login')}
            variant="ghost"
            className="text-white/80 hover:text-white hover:bg-white/10"
          >
            ← Back to login
          </Button>
        </div>
      </motion.div>

      {/* Method Picker Drawer */}
      <AnimatePresence>
        {showMethodPicker && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMethodPicker(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed bottom-0 start-0 end-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl z-50 max-w-md mx-auto"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Choose verification method
                  </h3>
                  <Button
                    onClick={() => setShowMethodPicker(false)}
                    variant="ghost"
                    size="icon"
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Close"
                  >
                    <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </Button>
                </div>

                <div className="space-y-3">
                  {(['totp', 'webauthn', 'recovery'] as MFAMethod[]).map((method) => (
                    <Button
                      key={method}
                      onClick={() => handleMethodChange(method)}
                      variant="outline"
                      className={`w-full h-auto justify-start gap-4 p-4 ${
                        currentMethod === method
                          ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                      }`}
                    >
                      <div className={`size-10 rounded-full flex items-center justify-center ${
                        currentMethod === method
                          ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}>
                        {getMethodIcon(method)}
                      </div>
                      <div className="flex-1 text-start">
                        <p className="font-medium text-gray-900 dark:text-white">
                          {getMethodLabel(method)}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {method === 'totp' && 'Use your authenticator app'}
                          {method === 'webauthn' && 'Use a hardware security key'}
                          {method === 'recovery' && 'Use a backup recovery code'}
                        </p>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
