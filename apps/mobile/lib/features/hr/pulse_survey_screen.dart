import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Pulse surveys — quick 1-5 mood check-ins with anonymous responses.
/// GET /v1/hrms/pulse-surveys
/// POST /v1/hrms/pulse-surveys/:id/respond
class PulseSurveyScreen extends ConsumerStatefulWidget {
  const PulseSurveyScreen({super.key});

  @override
  ConsumerState<PulseSurveyScreen> createState() => _PulseSurveyScreenState();
}

class _PulseSurveyScreenState extends ConsumerState<PulseSurveyScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _surveys = [];

  @override
  void initState() {
    super.initState();
    _fetchSurveys();
  }

  Future<void> _fetchSurveys() async {
    setState(() { _loading = true; _error = null; });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>('/v1/hrms/pulse-surveys');
      _surveys = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (e) { _error = e.toString(); }
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _respond(String surveyId, int score) async {
    try {
      final apiClient = ref.read(apiClientProvider);
      await apiClient.post<Map<String, dynamic>>(
        '/v1/hrms/pulse-surveys/$surveyId/respond',
        data: {'score': score},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Response submitted! +5 points 🎉'), backgroundColor: Color(0xFF15803D)));
        _fetchSurveys();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Pulse Check')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: FilledButton.icon(onPressed: _fetchSurveys, icon: const Icon(Icons.refresh), label: const Text('Retry')))
              : _surveys.isEmpty
                  ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                      const Text('🙌', style: TextStyle(fontSize: 48)),
                      const SizedBox(height: 16),
                      Text("You're all caught up!", style: theme.textTheme.bodyLarge),
                      const SizedBox(height: 4),
                      Text('No pending surveys', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                    ]))
                  : RefreshIndicator(
                      onRefresh: _fetchSurveys,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _surveys.length,
                        itemBuilder: (_, i) => _SurveyCard(
                          survey: _surveys[i],
                          onRespond: _respond,
                        ),
                      ),
                    ),
    );
  }
}

class _SurveyCard extends StatelessWidget {
  const _SurveyCard({required this.survey, required this.onRespond});
  final Map<String, dynamic> survey;
  final Future<void> Function(String id, int score) onRespond;

  static const _emojis = ['😞', '😕', '😐', '😊', '🤩'];
  static const _labels = ['Very Bad', 'Bad', 'Okay', 'Good', 'Great'];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final id = survey['id'] as String;
    final question = survey['question'] as String? ?? '';
    final category = survey['category'] as String? ?? '';
    final responded = survey['already_responded'] == true;
    final responseCount = (survey['response_count'] as num?)?.toInt() ?? 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF6366F1).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(category, style: const TextStyle(fontSize: 10, color: Color(0xFF6366F1), fontWeight: FontWeight.w600)),
              ),
              const Spacer(),
              if (responded) Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFF22C55E).withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                child: const Text('✓ Responded', style: TextStyle(fontSize: 10, color: Color(0xFF22C55E), fontWeight: FontWeight.w600)),
              ),
            ]),
            const SizedBox(height: 12),
            Text(question, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            if (!responded)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: List.generate(5, (i) => _EmojiButton(
                  emoji: _emojis[i],
                  label: _labels[i],
                  onTap: () => onRespond(id, i + 1),
                )),
              )
            else
              Text('$responseCount responses', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          ],
        ),
      ),
    );
  }
}

class _EmojiButton extends StatelessWidget {
  const _EmojiButton({required this.emoji, required this.label, required this.onTap});
  final String emoji;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(emoji, style: const TextStyle(fontSize: 32)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(fontSize: 9, color: Color(0xFF64748B))),
      ]),
    );
  }
}
