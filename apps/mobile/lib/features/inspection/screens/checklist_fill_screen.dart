/// Checklist Fill Screen — renders checklist sections with questions.
///
/// Features:
/// - Renders checklist sections with questions
/// - Different field types (text, number, boolean, select, photo, signature, geo_point)
/// - Conditional logic (show/hide based on answers)
/// - Mandatory field validation before submission
/// - Auto-save every 30s
/// - Offline indicator
///
/// SVC-102: Mobile Inspection Checklist
library;

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/inspection_models.dart';
import '../providers/inspection_provider.dart';

/// Screen for filling out a checklist during an inspection.
class ChecklistFillScreen extends ConsumerStatefulWidget {
  final String checklistInstanceId;

  const ChecklistFillScreen({
    super.key,
    required this.checklistInstanceId,
  });

  @override
  ConsumerState<ChecklistFillScreen> createState() => _ChecklistFillScreenState();
}

class _ChecklistFillScreenState extends ConsumerState<ChecklistFillScreen> {
  int _currentSectionIndex = 0;

  @override
  Widget build(BuildContext context) {
    final checklistState = ref.watch(checklistProvider);
    final instance = checklistState.instance;
    final syncState = ref.watch(inspectionSyncProvider);

    if (instance == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Checklist')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final sections = instance.sections;
    final currentSection = sections.isNotEmpty ? sections[_currentSectionIndex] : null;

    return Scaffold(
      appBar: AppBar(
        title: Text(currentSection?.title ?? 'Checklist'),
        actions: [
          // Offline indicator
          if (syncState.status == SyncStatus.idle || syncState.status == SyncStatus.error)
            const Padding(
              padding: EdgeInsets.only(right: 8),
              child: Tooltip(
                message: 'Working offline — responses will sync when online',
                child: Icon(Icons.cloud_off, size: 20, color: Colors.orange),
              ),
            ),
          // Auto-save indicator
          if (checklistState.lastAutoSave != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Tooltip(
                message: 'Last saved: ${_formatTime(checklistState.lastAutoSave!)}',
                child: const Icon(Icons.save, size: 20, color: Colors.green),
              ),
            ),
        ],
      ),
      body: Column(
        children: [
          // Section progress indicator
          _SectionProgressBar(
            totalSections: sections.length,
            currentIndex: _currentSectionIndex,
            sectionScores: instance.sectionScores,
            sections: sections,
          ),
          // Questions
          Expanded(
            child: currentSection != null
                ? _QuestionList(
                    section: currentSection,
                    responses: instance.responses,
                    onResponseChanged: _handleResponseChanged,
                  )
                : const Center(child: Text('No sections available')),
          ),
          // Navigation buttons
          _NavigationBar(
            currentIndex: _currentSectionIndex,
            totalSections: sections.length,
            onPrevious: _currentSectionIndex > 0
                ? () => setState(() => _currentSectionIndex--)
                : null,
            onNext: _currentSectionIndex < sections.length - 1
                ? () => setState(() => _currentSectionIndex++)
                : null,
            onSubmit: _currentSectionIndex == sections.length - 1
                ? _handleSubmit
                : null,
          ),
        ],
      ),
    );
  }

  void _handleResponseChanged(String questionId, dynamic value) {
    final response = ChecklistResponse(
      questionId: questionId,
      value: value,
      capturedAt: DateTime.now().toIso8601String(),
      deviceId: 'device-placeholder', // TODO: wire to actual device ID
      // TODO: wire GPS coordinates from device location service
    );
    ref.read(checklistProvider.notifier).recordResponse(questionId, response);
  }

  Future<void> _handleSubmit() async {
    final instance = ref.read(checklistProvider).instance;
    if (instance == null) return;

    // Validate all required fields
    final missingRequired = <String>[];
    for (final section in instance.sections) {
      for (final question in section.questions) {
        if (question.required && !instance.responses.containsKey(question.id)) {
          missingRequired.add(question.text);
        }
      }
    }

    if (missingRequired.isNotEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Please complete ${missingRequired.length} required field(s) before submitting',
          ),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    // Submit
    await ref.read(checklistProvider.notifier).submitChecklist();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Checklist submitted successfully'),
        backgroundColor: Colors.green,
      ),
    );
    Navigator.of(context).pop();
  }

  String _formatTime(DateTime time) {
    return '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
  }
}

/// Progress bar showing completion across sections.
class _SectionProgressBar extends StatelessWidget {
  final int totalSections;
  final int currentIndex;
  final Map<String, double> sectionScores;
  final List<ChecklistSection> sections;

  const _SectionProgressBar({
    required this.totalSections,
    required this.currentIndex,
    required this.sectionScores,
    required this.sections,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: List.generate(totalSections, (index) {
          final sectionId = sections[index].id;
          final score = sectionScores[sectionId] ?? 0.0;
          final isActive = index == currentIndex;

          return Expanded(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              height: 4,
              decoration: BoxDecoration(
                color: isActive
                    ? Theme.of(context).colorScheme.primary
                    : score >= 100
                        ? Colors.green
                        : score > 0
                            ? Colors.orange
                            : Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          );
        }),
      ),
    );
  }
}

/// List of questions for the current section.
class _QuestionList extends StatelessWidget {
  final ChecklistSection section;
  final Map<String, ChecklistResponse> responses;
  final void Function(String questionId, dynamic value) onResponseChanged;

  const _QuestionList({
    required this.section,
    required this.responses,
    required this.onResponseChanged,
  });

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: section.questions.length,
      itemBuilder: (context, index) {
        final question = section.questions[index];

        // TODO: evaluate conditional logic to show/hide questions
        // For now, show all questions.

        return _QuestionField(
          question: question,
          currentValue: responses[question.id]?.value,
          onChanged: (value) => onResponseChanged(question.id, value),
        );
      },
    );
  }
}

/// Renders the appropriate input field based on question fieldType.
class _QuestionField extends StatelessWidget {
  final ChecklistQuestion question;
  final dynamic currentValue;
  final ValueChanged<dynamic> onChanged;

  const _QuestionField({
    required this.question,
    required this.currentValue,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Question label
          Row(
            children: [
              Expanded(
                child: Text(
                  question.text,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ),
              if (question.required)
                Text(
                  ' *',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                    fontWeight: FontWeight.bold,
                  ),
                ),
            ],
          ),
          if (question.helpText != null) ...[
            const SizedBox(height: 4),
            Text(
              question.helpText!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ],
          const SizedBox(height: 8),
          // Field input based on type
          _buildField(context),
        ],
      ),
    );
  }

  Widget _buildField(BuildContext context) {
    return switch (question.fieldType) {
      'text' => TextFormField(
          initialValue: currentValue as String?,
          onChanged: onChanged,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Enter text',
          ),
        ),
      'number' => TextFormField(
          initialValue: currentValue?.toString(),
          keyboardType: TextInputType.number,
          onChanged: (v) => onChanged(num.tryParse(v)),
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Enter number',
          ),
        ),
      'boolean' => SwitchListTile(
          title: const Text('Yes / No'),
          value: currentValue as bool? ?? false,
          onChanged: onChanged,
          contentPadding: EdgeInsets.zero,
        ),
      'select' => DropdownButtonFormField<String>(
          value: currentValue as String?,
          items: const [
            // TODO: populate from question.validationRules options
            DropdownMenuItem(value: 'option1', child: Text('Option 1')),
            DropdownMenuItem(value: 'option2', child: Text('Option 2')),
          ],
          onChanged: onChanged,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Select option',
          ),
        ),
      'photo' => OutlinedButton.icon(
          onPressed: () {
            // TODO: wire to evidence capture screen / camera
            onChanged('photo_captured');
          },
          icon: const Icon(Icons.camera_alt),
          label: Text(currentValue != null ? 'Photo captured ✓' : 'Capture Photo'),
        ),
      'signature' => OutlinedButton.icon(
          onPressed: () {
            // TODO: wire to signature capture widget
            onChanged('signature_captured');
          },
          icon: const Icon(Icons.draw),
          label: Text(currentValue != null ? 'Signature captured ✓' : 'Capture Signature'),
        ),
      'geo_point' => OutlinedButton.icon(
          onPressed: () {
            // TODO: wire to GPS location service
            onChanged({'latitude': 0.0, 'longitude': 0.0});
          },
          icon: const Icon(Icons.location_on),
          label: Text(currentValue != null ? 'Location captured ✓' : 'Capture Location'),
        ),
      _ => Text('Unsupported field type: ${question.fieldType}'),
    };
  }
}

/// Bottom navigation bar for section navigation.
class _NavigationBar extends StatelessWidget {
  final int currentIndex;
  final int totalSections;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;
  final VoidCallback? onSubmit;

  const _NavigationBar({
    required this.currentIndex,
    required this.totalSections,
    this.onPrevious,
    this.onNext,
    this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 4,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Row(
        children: [
          if (onPrevious != null)
            OutlinedButton.icon(
              onPressed: onPrevious,
              icon: const Icon(Icons.arrow_back),
              label: const Text('Previous'),
            ),
          const Spacer(),
          Text(
            '${currentIndex + 1} / $totalSections',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const Spacer(),
          if (onNext != null)
            FilledButton.icon(
              onPressed: onNext,
              icon: const Icon(Icons.arrow_forward),
              label: const Text('Next'),
            ),
          if (onSubmit != null)
            FilledButton.icon(
              onPressed: onSubmit,
              icon: const Icon(Icons.check),
              label: const Text('Submit'),
            ),
        ],
      ),
    );
  }
}
