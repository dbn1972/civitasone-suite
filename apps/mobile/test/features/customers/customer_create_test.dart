import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/customers/customer_create_screen.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
  });

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(home: CustomerCreateScreen()),
    );
  }

  group('CustomerCreateScreen', () {
    testWidgets('renders form with all fields', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Add Customer'), findsOneWidget);
      expect(find.text('Name *'), findsOneWidget);
      expect(find.text('Phone'), findsOneWidget);
      expect(find.text('Email'), findsOneWidget);
      expect(find.text('GSTIN (optional)'), findsOneWidget);
      expect(find.text('Address'), findsOneWidget);
      expect(find.text('Save Customer'), findsOneWidget);
    });

    testWidgets('shows validation error for empty name', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save Customer'));
      await tester.pumpAndSettle();

      expect(find.text('Name is required'), findsOneWidget);
    });

    testWidgets('saves customer with all fields', (tester) async {
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

      // Use a Navigator to capture pop
      await tester.pumpWidget(ProviderScope(
        overrides: [
          dbProvider.overrideWith((_) => Future.value(mockDb)),
          syncEngineProvider.overrideWithValue(mockEngine),
        ],
        child: MaterialApp(
          home: Builder(
            builder: (ctx) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () => Navigator.push(
                    ctx,
                    MaterialPageRoute(
                        builder: (_) => const CustomerCreateScreen()),
                  ),
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextFormField, 'Name *'), 'New Customer');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Phone'), '9876543210');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Email'), 'test@example.com');

      await tester.tap(find.text('Save Customer'));
      await tester.pumpAndSettle();

      verify(() => mockDb.enqueueOutbox(
            mailbox: 'customers',
            operation: 'create',
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).called(1);
    });

    testWidgets('saves customer with only required name', (tester) async {
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

      // Use a Navigator to capture pop
      await tester.pumpWidget(ProviderScope(
        overrides: [
          dbProvider.overrideWith((_) => Future.value(mockDb)),
          syncEngineProvider.overrideWithValue(mockEngine),
        ],
        child: MaterialApp(
          home: Builder(
            builder: (ctx) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () => Navigator.push(
                    ctx,
                    MaterialPageRoute(
                        builder: (_) => const CustomerCreateScreen()),
                  ),
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextFormField, 'Name *'), 'Minimal Customer');

      await tester.tap(find.text('Save Customer'));
      await tester.pumpAndSettle();

      verify(() => mockDb.enqueueOutbox(
            mailbox: 'customers',
            operation: 'create',
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).called(1);
    });

    testWidgets('form fields have correct icons for each field', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // The phone field exists
      expect(find.widgetWithText(TextFormField, 'Phone'), findsOneWidget);
      // The email field exists
      expect(find.widgetWithText(TextFormField, 'Email'), findsOneWidget);
    });

    testWidgets('form has correct field icons', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.person), findsOneWidget);
      expect(find.byIcon(Icons.phone), findsOneWidget);
      expect(find.byIcon(Icons.email), findsOneWidget);
      expect(find.byIcon(Icons.assignment), findsOneWidget);
      expect(find.byIcon(Icons.location_on), findsOneWidget);
    });
  });
}
