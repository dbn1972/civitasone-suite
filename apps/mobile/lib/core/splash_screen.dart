import 'package:flutter/material.dart';

/// Splash screen — brand-forward loading while tokens are verified.
/// Shows for 1-2 seconds max while:
/// 1. Checking if tokens exist in secure storage
/// 2. Checking if biometric/PIN lock is needed
/// 3. Initializing sync database
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              theme.colorScheme.primary,
              theme.colorScheme.tertiary,
            ],
          ),
        ),
        child: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(flex: 3),
              // App icon
              Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Icon(Icons.account_balance,
                    size: 48, color: Colors.white),
              ),
              const SizedBox(height: 24),
              const Text(
                'CivitasOne',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Government · PSU · Enterprise',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.white.withOpacity(0.7),
                ),
              ),
              const SizedBox(height: 48),
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: Colors.white.withOpacity(0.8),
                ),
              ),
              const Spacer(flex: 2),
              // Footer
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: Column(children: [
                  Text(
                    'Secured with device encryption',
                    style: TextStyle(
                        fontSize: 12, color: Colors.white.withOpacity(0.5)),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.shield_outlined,
                          size: 14, color: Colors.white.withOpacity(0.5)),
                      const SizedBox(width: 4),
                      Text(
                        'Offline-first · PKCE · Encrypted',
                        style: TextStyle(
                            fontSize: 11, color: Colors.white.withOpacity(0.4)),
                      ),
                    ],
                  ),
                ]),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
