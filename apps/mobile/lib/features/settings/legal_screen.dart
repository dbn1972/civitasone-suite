import 'package:flutter/material.dart';
import '../../legal/privacy_policy.dart';
import '../../legal/terms_of_use.dart';
import '../../legal/security_disclosure.dart';

/// Legal document viewer — privacy policy, terms of use, security practices.
class LegalScreen extends StatelessWidget {
  const LegalScreen({super.key, required this.type});

  final LegalDocType type;

  String get _title => switch (type) {
    LegalDocType.privacy => 'Privacy Policy',
    LegalDocType.terms => 'Terms of Use',
    LegalDocType.security => 'Security Practices',
  };

  String get _content => switch (type) {
    LegalDocType.privacy => privacyPolicyText,
    LegalDocType.terms => termsOfUseText,
    LegalDocType.security => securityDisclosureText,
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: SelectableText(
          _content,
          style: theme.textTheme.bodyMedium?.copyWith(height: 1.6),
        ),
      ),
    );
  }
}

enum LegalDocType { privacy, terms, security }
