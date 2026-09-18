import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/widgets/status_pill.dart';
import 'package:civitasone_mobile/features/approvals/approvals_models.dart';
import 'package:civitasone_mobile/features/approvals/approvals_task_detail_screen.dart';

/// Scope status-word assertions to the pill specifically, since a status
/// word can also appear elsewhere on the page (same convention as
/// `field_task_detail_test.dart` / `approvals_workbasket_list_test.dart`).
Finder _statusPillText(String text) =>
    find.descendant(of: find.byType(StatusPill), matching: find.text(text));

void main() {
  Widget buildSubject({required String taskId, WorkbasketTask? task}) {
    return MaterialApp(
      home: ApprovalsTaskDetailScreen(taskId: taskId, task: task),
    );
  }

  final sampleTask = WorkbasketTask.fromJson({
    'id': 'task-1',
    'tenantId': 't1',
    'instanceId': 'inst-1',
    'name': 'Approve leave for R. Sharma',
    'status': 'pending',
    'roleRef': 'hr_admin',
    'nodeKey': 'node-approve',
    'refType': 'leave_app',
    'refId': 'leave-9001',
    'decision': null,
    'assigneeId': null,
    'dueAt': '2026-09-25T10:00:00.000Z',
    'escalationCount': 0,
    'createdAt': '2026-09-15T08:00:00.000Z',
    'updatedAt': '2026-09-16T08:00:00.000Z',
    'version': 1,
  });

  group('ApprovalsTaskDetailScreen -- with a task (navigated from the list)', () {
    testWidgets('renders name, status, reference type, and assignment', (tester) async {
      await tester.pumpWidget(buildSubject(taskId: 'task-1', task: sampleTask));
      await tester.pump();

      // Appears twice: the AppBar title and the header card title.
      expect(find.text('Approve leave for R. Sharma'), findsNWidgets(2));
      expect(_statusPillText('Pending'), findsOneWidget);
      expect(find.text('Leave Application'), findsOneWidget);
      expect(find.text('leave-9001'), findsOneWidget);
      expect(find.text('inst-1'), findsOneWidget);
      expect(find.text('hr_admin'), findsOneWidget);
      expect(find.text('Unassigned'), findsOneWidget);
    });

    testWidgets('shows formatted due/created/updated dates', (tester) async {
      await tester.pumpWidget(buildSubject(taskId: 'task-1', task: sampleTask));
      await tester.pump();

      expect(find.textContaining('25/09/2026'), findsOneWidget);
      expect(find.textContaining('15/09/2026'), findsOneWidget);
      expect(find.textContaining('16/09/2026'), findsOneWidget);
    });

    testWidgets('does not show an escalations row when escalationCount is 0', (tester) async {
      await tester.pumpWidget(buildSubject(taskId: 'task-1', task: sampleTask));
      await tester.pump();

      expect(find.text('Escalations'), findsNothing);
    });

    testWidgets('shows an escalations row when escalationCount is greater than 0', (tester) async {
      final escalated = WorkbasketTask.fromJson({
        'id': 'task-2',
        'tenantId': 't1',
        'instanceId': 'inst-2',
        'name': 'Approve overdue PO',
        'status': 'escalated',
        'refType': 'procurement_po',
        'escalationCount': 2,
        'createdAt': '2026-09-01T08:00:00.000Z',
        'updatedAt': '2026-09-16T08:00:00.000Z',
        'version': 1,
      });

      await tester.pumpWidget(buildSubject(taskId: 'task-2', task: escalated));
      await tester.pump();

      expect(find.text('Escalations'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('an unrecognized refType falls back to the raw string, not a fabricated label', (tester) async {
      final task = WorkbasketTask.fromJson({
        'id': 'task-3',
        'tenantId': 't1',
        'instanceId': 'inst-3',
        'name': 'Something new',
        'status': 'active',
        'refType': 'grievance_case',
        'createdAt': '2026-09-01T08:00:00.000Z',
        'updatedAt': '2026-09-01T08:00:00.000Z',
        'version': 1,
      });

      await tester.pumpWidget(buildSubject(taskId: 'task-3', task: task));
      await tester.pump();

      expect(find.text('grievance_case'), findsOneWidget);
    });

    testWidgets('shows the overdue banner for a pending task past its due date', (tester) async {
      final overdue = WorkbasketTask.fromJson({
        'id': 'task-4',
        'tenantId': 't1',
        'instanceId': 'inst-4',
        'name': 'Approve overdue leave',
        'status': 'pending',
        'dueAt': '2020-01-01T00:00:00.000Z',
        'createdAt': '2026-09-01T08:00:00.000Z',
        'updatedAt': '2026-09-01T08:00:00.000Z',
        'version': 1,
      });

      await tester.pumpWidget(buildSubject(taskId: 'task-4', task: overdue));
      await tester.pump();

      expect(find.text('This task is overdue.'), findsOneWidget);
    });

    testWidgets('does not show the overdue banner for a completed task past its due date', (tester) async {
      final completed = WorkbasketTask.fromJson({
        'id': 'task-5',
        'tenantId': 't1',
        'instanceId': 'inst-5',
        'name': 'Already approved leave',
        'status': 'completed',
        'dueAt': '2020-01-01T00:00:00.000Z',
        'createdAt': '2026-09-01T08:00:00.000Z',
        'updatedAt': '2026-09-01T08:00:00.000Z',
        'version': 1,
      });

      await tester.pumpWidget(buildSubject(taskId: 'task-5', task: completed));
      await tester.pump();

      expect(find.text('This task is overdue.'), findsNothing);
    });
  });

  group('ApprovalsTaskDetailScreen -- no task (direct deep link, nothing to render)', () {
    testWidgets('shows an explanatory unavailable state instead of crashing', (tester) async {
      await tester.pumpWidget(buildSubject(taskId: 'task-9', task: null));
      await tester.pump();

      expect(find.text('Task details unavailable'), findsOneWidget);
      expect(find.textContaining('task-9'), findsWidgets);
      expect(find.text('Go back'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
