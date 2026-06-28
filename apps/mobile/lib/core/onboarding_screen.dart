import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';

/// First-time onboarding — 3 slides introducing key features.
/// Shows only once per device (tracked via secure storage flag).
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  static const _seenKey = 'civitasone_onboarding_seen';

  /// Check if onboarding has been completed.
  static Future<bool> hasCompleted() async {
    const storage = FlutterSecureStorage();
    final seen = await storage.read(key: _seenKey);
    return seen == 'true';
  }

  /// Mark onboarding as completed.
  static Future<void> markCompleted() async {
    const storage = FlutterSecureStorage();
    await storage.write(key: _seenKey, value: 'true');
  }

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  int _currentPage = 0;

  static const _pages = [
    _OnboardingPage(
      icon: Icons.offline_bolt,
      title: 'Works Offline',
      description: 'Apply leave, mark attendance, and file expenses even without internet. Everything syncs automatically when you reconnect.',
      gradient: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
    ),
    _OnboardingPage(
      icon: Icons.fingerprint,
      title: 'Secure & Simple',
      description: 'Sign in once, unlock with fingerprint. Your data is encrypted on-device. No passwords to remember daily.',
      gradient: [Color(0xFF22C55E), Color(0xFF10B981)],
    ),
    _OnboardingPage(
      icon: Icons.speed,
      title: '3 Taps to Anything',
      description: 'Check-in at gate, view salary, approve leave — everything is just 3 taps away. Designed for speed.',
      gradient: [Color(0xFFF59E0B), Color(0xFFEC4899)],
    ),
  ];

  void _nextPage() {
    if (_currentPage < _pages.length - 1) {
      _controller.nextPage(duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    } else {
      _finish();
    }
  }

  void _finish() {
    HapticFeedback.mediumImpact();
    OnboardingScreen.markCompleted();
    context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Column(children: [
          // Skip button
          Align(
            alignment: Alignment.topRight,
            child: TextButton(
              onPressed: _finish,
              child: Text('Skip', style: TextStyle(color: theme.colorScheme.outline)),
            ),
          ),

          // Pages
          Expanded(
            child: PageView.builder(
              controller: _controller,
              onPageChanged: (i) => setState(() => _currentPage = i),
              itemCount: _pages.length,
              itemBuilder: (_, i) => _buildPage(_pages[i]),
            ),
          ),

          // Dots + next button
          Padding(
            padding: const EdgeInsets.all(24),
            child: Row(children: [
              // Dots
              Row(children: List.generate(_pages.length, (i) => Container(
                width: i == _currentPage ? 24 : 8,
                height: 8,
                margin: const EdgeInsets.only(right: 6),
                decoration: BoxDecoration(
                  color: i == _currentPage ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(4),
                ),
              ))),
              const Spacer(),
              // Next / Get Started button
              FilledButton(
                onPressed: _nextPage,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                ),
                child: Text(_currentPage == _pages.length - 1 ? 'Get Started' : 'Next'),
              ),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _buildPage(_OnboardingPage page) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: page.gradient),
              borderRadius: BorderRadius.circular(32),
            ),
            child: Icon(page.icon, size: 56, color: Colors.white),
          ),
          const SizedBox(height: 40),
          Text(page.title,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center),
          const SizedBox(height: 16),
          Text(page.description,
              style: TextStyle(fontSize: 15, color: Theme.of(context).colorScheme.onSurfaceVariant, height: 1.5),
              textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _OnboardingPage {
  const _OnboardingPage({
    required this.icon,
    required this.title,
    required this.description,
    required this.gradient,
  });
  final IconData icon;
  final String title;
  final String description;
  final List<Color> gradient;
}
