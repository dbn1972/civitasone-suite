import { motion } from 'motion/react';
import { CheckCircle2, Shield, Lock } from 'lucide-react';

export function Dashboard() {
  return (
    <div className="size-full min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-2xl w-full"
      >
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-12 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-flex items-center justify-center size-24 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full mb-6 shadow-lg"
          >
            <CheckCircle2 className="size-12 text-white" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold text-gray-900 dark:text-white mb-4"
          >
            Authentication Successful!
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-lg text-gray-600 dark:text-gray-400 mb-8"
          >
            You've successfully logged in to CivitasOne Suite
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl p-6 mb-8"
          >
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="inline-flex items-center justify-center size-12 bg-indigo-100 dark:bg-indigo-800 rounded-full mb-2">
                  <Lock className="size-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Secure Login</p>
              </div>
              <div className="text-center">
                <div className="inline-flex items-center justify-center size-12 bg-purple-100 dark:bg-purple-800 rounded-full mb-2">
                  <Shield className="size-6 text-purple-600 dark:text-purple-400" />
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">MFA Verified</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="space-y-3"
          >
            <a
              href="/auth/login"
              className="inline-block px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium shadow-lg hover:shadow-xl transition-all"
            >
              Back to Login (Test Again)
            </a>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
