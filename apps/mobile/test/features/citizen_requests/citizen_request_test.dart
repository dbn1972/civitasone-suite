import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/citizen_requests/citizen_requests_screen.dart';
import 'package:civitasone_mobile/features/citizen_requests/request_filing_screen.dart';
import 'package:civitasone_mobile/features/citizen_requests/models.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  final sampleRequests = [
    {
      'data': {
        'id': 'req-1',
        'tenantId': 't1',
        'requestNo': 'REQ-2024-0001',
        'category': 'water',
        'subject': 'Water supply disruption',
        'description': 'No water since morning',
        'status': 'inProgress',
        'priority': 'high',
        'createdAt': '2024-01-15T08:00:00.000Z',
        'timeline': [
          {
            'id': 'tl-1',
            'action': 'Request submitted',
            'actor': 'Citizen',
            'timestamp': '2024-01-15T08:00:00.000Z',
            'toStatus': 'submitted',
          },
          {
            'id': 'tl-2',
            'action': 'Assigned to engineer',
            'actor': 'Desk Officer',
            'timestamp': '2024-01-15T09:30:00.000Z',
            'toStatus': 'inProgress',
          },
        ],
        'citizenName': 'Amit Singh',
        'citizenPhone': '9876543210',
        'slaDeadline': '2024-01-18T08:00:00.000Z',
      },
    },
    {
      'data': {
        'id': 'req-2',
        'tenantId': 't1',
        'requestNo': 'REQ-2024-0002',
        'category': 'roads',
        'subject': 'Pothole on main road',
        'description': 'Large pothole near bus stop',
        'status': 'submitted',
        'priority': 'medium',
        'createdAt': '2024-01-14T10:00:00.000Z',
        'timeline': [],
        'slaDeadline': '2024-01-17T10:00:00.000Z',
      },
    },
  ];

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
  });

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  group('CitizenRequestsScreen', () {
    Widget buildListSubject({List<Map<String, dynamic>>? requests}) {
      when(() => mockDb.listEntities('citizen_requests'))
          .thenAnswer((_) async => requests ?? sampleRequests);

      return ProviderScope(
        overrides: [
          dbProvider.overrideWith((_) => Future.value(mockDb)),
          syncEngineProvider.overrideWithValue(mockEngine),
        ],
        child: const MaterialApp(
            home: CitizenRequestsScreen(connectivityOverride: true)),
      );
    }

    testWidgets('renders with title', (tester) async {
      await tester.pumpWidget(buildListSubject());
      await tester.pumpAndSettle();

      expect(find.text('Citizen Requests'), findsOneWidget);
    });

    testWidgets('shows FAB for new request', (tester) async {
      await tester.pumpWidget(buildListSubject());
      await tester.pumpAndSettle();

      expect(find.text('New Request'), findsOneWidget);
    });

    testWidgets('displays request list', (tester) async {
      await tester.pumpWidget(buildListSubject());
      await tester.pumpAndSettle();

      expect(find.text('Water supply disruption'), findsOneWidget);
      expect(find.text('Pothole on main road'), findsOneWidget);
    });

    testWidgets('shows request numbers', (tester) async {
      await tester.pumpWidget(buildListSubject());
      await tester.pumpAndSettle();

      expect(find.textContaining('REQ-2024-0001'), findsOneWidget);
      expect(find.textContaining('REQ-2024-0002'), findsOneWidget);
    });

    testWidgets('shows status badges', (tester) async {
      await tester.pumpWidget(buildListSubject());
      await tester.pumpAndSettle();

      expect(find.text('inProgress'), findsOneWidget);
      expect(find.text('submitted'), findsOneWidget);
    });

    testWidgets('shows empty state when no requests', (tester) async {
      await tester.pumpWidget(buildListSubject(requests: []));
      await tester.pumpAndSettle();

      expect(find.text('No requests filed yet'), findsOneWidget);
    });
  });

  group('RequestFilingScreen', () {
    Widget buildFilingSubject() {
      when(() => mockDb.enqueueOutbox(
            mailbox: any(named: 'mailbox'),
            operation: any(named: 'operation'),
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).thenAnswer((_) async => 'outbox-id');
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'),
            mailbox: any(named: 'mailbox'),
            data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'),
            syncState: any(named: 'syncState'),
          )).thenAnswer((_) async {});

      return ProviderScope(
        overrides: [
          dbProvider.overrideWith((_) => Future.value(mockDb)),
          syncEngineProvider.overrideWithValue(mockEngine),
        ],
        child: const MaterialApp(
            home: RequestFilingScreen(connectivityOverride: true)),
      );
    }

    testWidgets('renders with title', (tester) async {
      await tester.pumpWidget(buildFilingSubject());
      await tester.pumpAndSettle();

      expect(find.text('File Request'), findsOneWidget);
    });

    testWidgets('shows category chips', (tester) async {
      await tester.pumpWidget(buildFilingSubject());
      await tester.pumpAndSettle();

      expect(find.text('Water'), findsOneWidget);
      expect(find.text('Roads'), findsOneWidget);
      expect(find.text('Electricity'), findsOneWidget);
    });

    testWidgets('shows subject and description fields', (tester) async {
      await tester.pumpWidget(buildFilingSubject());
      await tester.pumpAndSettle();

      expect(find.text('Subject'), findsOneWidget);
      expect(find.text('Description'), findsOneWidget);
    });

    testWidgets('shows validation error without category', (tester) async {
      await tester.pumpWidget(buildFilingSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Submit Request'));
      await tester.pumpAndSettle();

      expect(find.text('Please select a category'), findsOneWidget);
    });

    testWidgets('shows validation error without subject', (tester) async {
      await tester.pumpWidget(buildFilingSubject());
      await tester.pumpAndSettle();

      // Select category
      await tester.tap(find.text('Water'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Submit Request'));
      await tester.pumpAndSettle();

      expect(find.text('Please enter a subject'), findsOneWidget);
    });

    testWidgets('successful submission enqueues to outbox', (tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildFilingSubject());
      await tester.pumpAndSettle();

      // Select category by tapping the first ChoiceChip (Water)
      final waterChip = find.widgetWithText(ChoiceChip, 'Water');
      expect(waterChip, findsOneWidget);
      await tester.tap(waterChip);
      await tester.pumpAndSettle();

      // Enter subject in first TextField matching 'Subject' label
      final subjectFields = find.widgetWithText(TextField, 'Subject');
      expect(subjectFields, findsOneWidget);
      await tester.enterText(subjectFields, 'No water supply');
      await tester.pumpAndSettle();

      // Tap submit - the button is in a sticky footer, always visible
      final submitBtn = find.text('Submit Request');
      expect(submitBtn, findsOneWidget);
      await tester.tap(submitBtn);
      await tester.pump(const Duration(seconds: 2));

      // Check if snackbar appeared (validation failure indicator)
      final categorySnack = find.text('Please select a category');
      final subjectSnack = find.text('Please enter a subject');

      if (categorySnack.evaluate().isNotEmpty) {
        // Category wasn't set — skip the verify, test the other cases instead
        fail('Category was not selected despite tapping Water chip');
      }
      if (subjectSnack.evaluate().isNotEmpty) {
        fail('Subject was not set despite enterText');
      }

      verify(() => mockDb.enqueueOutbox(
            mailbox: 'citizen_requests',
            operation: 'create',
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).called(1);
    });
  });

  group('CitizenRequest model', () {
    test('isSlaBreached returns true when deadline passed', () {
      final req = CitizenRequest(
        id: 'r1',
        tenantId: 't1',
        requestNo: 'REQ-001',
        category: RequestCategory.water,
        subject: 'Test',
        description: '',
        status: RequestStatus.inProgress,
        priority: RequestPriority.high,
        createdAt: DateTime(2024, 1, 1),
        timeline: [],
        slaDeadline: DateTime(2024, 1, 2), // in the past
      );
      expect(req.isSlaBreached, isTrue);
    });

    test('isSlaBreached returns false when resolved', () {
      final req = CitizenRequest(
        id: 'r1',
        tenantId: 't1',
        requestNo: 'REQ-001',
        category: RequestCategory.water,
        subject: 'Test',
        description: '',
        status: RequestStatus.resolved,
        priority: RequestPriority.high,
        createdAt: DateTime(2024, 1, 1),
        timeline: [],
        slaDeadline: DateTime(2024, 1, 2), // in the past but resolved
      );
      expect(req.isSlaBreached, isFalse);
    });

    test('ageDays calculates correctly', () {
      final req = CitizenRequest(
        id: 'r1',
        tenantId: 't1',
        requestNo: 'REQ-001',
        category: RequestCategory.roads,
        subject: 'Test',
        description: '',
        status: RequestStatus.submitted,
        priority: RequestPriority.medium,
        createdAt: DateTime.now().toUtc().subtract(const Duration(days: 5)),
        timeline: [],
      );
      expect(req.ageDays, 5);
    });

    test('resolutionTime returns duration when resolved', () {
      final created = DateTime(2024, 1, 1, 8, 0);
      final resolved = DateTime(2024, 1, 3, 10, 0);
      final req = CitizenRequest(
        id: 'r1',
        tenantId: 't1',
        requestNo: 'REQ-001',
        category: RequestCategory.sanitation,
        subject: 'Test',
        description: '',
        status: RequestStatus.resolved,
        priority: RequestPriority.low,
        createdAt: created,
        timeline: [],
        resolvedAt: resolved,
      );
      expect(req.resolutionTime!.inHours, 50);
    });

    test('AttachedDocument formattedSize works', () {
      final doc = AttachedDocument(
        id: 'd1',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        url: 'https://example.com/photo.jpg',
        uploadedAt: _demoDate,
        sizeBytes: 2500000,
      );
      expect(doc.formattedSize, '2.4MB');
    });
  });
}

final _demoDate = DateTime(2024, 1, 15);
